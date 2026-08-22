/**
 * Acceso a la base con contexto de tenant.
 *
 * ======================================================================
 * LEER ESTO ANTES DE ESCRIBIR CUALQUIER CONSULTA
 * ======================================================================
 *
 * RLS está activo en la base, pero RLS NO PROTEGE NADA por sí solo: las
 * políticas comparan contra `current_setting('app.tenant_id')`, y si nadie
 * setea esa variable, o si se setea mal, el aislamiento no existe.
 *
 * LA TRAMPA QUE HUNDE ESTOS PROYECTOS:
 *
 *   Un pool de conexiones reutiliza conexiones entre requests. Si hacés
 *
 *       SET app.tenant_id = '...'        <-- SIN "LOCAL"
 *
 *   la variable queda pegada a la CONEXIÓN. Esa conexión vuelve al pool, la
 *   agarra el request de otro consultorio, y ese request ve los datos del
 *   anterior. Es una fuga total entre clientes, no tira ningún error, y
 *   aparece solo cuando hay concurrencia — o sea, en producción.
 *
 * LA REGLA, SIN EXCEPCIONES:
 *
 *   1. `SET LOCAL`, nunca `SET`. `LOCAL` ata la variable a la TRANSACCIÓN,
 *      y al terminar se descarta sola.
 *   2. Siempre dentro de una transacción explícita.
 *   3. Toda consulta de la app pasa por `withTenant()`. Ninguna ruta importa
 *      el pool directamente.
 *
 * Por eso este módulo NO exporta el pool ni una instancia de drizzle suelta:
 * la única forma de llegar a la base es a través de las funciones de acá.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import * as schema from './schema'

export * as schema from './schema'
export * from './schema'

export type Db = NodePgDatabase<typeof schema>
export type TenantRole = 'owner' | 'admin' | 'agent'

export type TenantContext = {
  tenantId: string
  userId: string
  role: TenantRole
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('Falta DATABASE_URL')
}

// Privado a propósito. Ver el comentario de arriba.
const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  // Si una consulta se cuelga, no queremos que se coma una conexión del pool
  // para siempre: bajo carga eso agota el pool y cae todo el panel.
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 10_000,
})

const db = drizzle(pool, { schema })

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES: readonly TenantRole[] = ['owner', 'admin', 'agent']

/**
 * Corre `fn` dentro de una transacción con el contexto de tenant seteado.
 * Todo lo que se consulte adentro queda limitado a ese tenant por RLS.
 *
 *   const contactos = await withTenant(ctx, (tx) =>
 *     tx.select().from(contacts).limit(50)
 *   )
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  // Validación estricta antes de interpolar. Los parámetros de bind ($1) no
  // funcionan en SET LOCAL, así que el valor va interpolado — y por eso tiene
  // que ser imposible que llegue algo que no sea un UUID o un rol conocido.
  if (!UUID_RE.test(ctx.tenantId)) {
    throw new Error('tenantId inválido')
  }
  if (!UUID_RE.test(ctx.userId)) {
    throw new Error('userId inválido')
  }
  if (!ROLES.includes(ctx.role)) {
    throw new Error(`rol inválido: ${ctx.role}`)
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`set local app.tenant_id = '${ctx.tenantId}'`),
    )
    await tx.execute(sql.raw(`set local app.user_id = '${ctx.userId}'`))
    await tx.execute(sql.raw(`set local app.user_role = '${ctx.role}'`))
    return fn(tx)
  })
}

/**
 * Para lo que legítimamente vive fuera de un tenant: login, resolución de a qué
 * consultorios pertenece un usuario, y el panel de superadmin.
 *
 * Sin contexto de tenant, RLS devuelve CERO filas de las tablas operativas
 * (fail-closed), así que esto no es una puerta trasera: solo sirve para las
 * tablas que no llevan tenant_id.
 */
export async function withoutTenant<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx))
}

// =====================================================================
// CAMINO DE SISTEMA
// =====================================================================
/**
 * Conexión privilegiada para los caminos internos: ingesta de mensajes,
 * `deliverMessage` y el agente de IA.
 *
 * POR QUÉ EXISTE
 * Un mensaje entrante llega identificado por la cuenta de WhatsApp, no por un
 * tenant: el sistema no sabe de qué consultorio es hasta que resuelve esa
 * cuenta. Con RLS activo y sin contexto, ese INSERT se rechaza (42501). No es
 * un caso de usuario, es un caso de sistema.
 *
 * POR QUÉ NO ES UN AGUJERO
 * Lo que hace segura a esta conexión no es RLS: es que **el tenant nunca sale
 * del input**. En todos los caminos que la usan, el tenant_id se DERIVA de una
 * fila que ya existe en la base:
 *
 *   - ingesta         → de `channel_accounts` por el accountId del worker
 *   - deliverMessage  → de `conversations` por el conversationId
 *   - agente          → de la conversación que está atendiendo
 *
 * REGLAS PARA USARLA
 *   1. NUNCA se llama desde una ruta que reciba datos del navegador.
 *   2. NUNCA se le pasa un tenantId que venga de un request.
 *   3. Todo camino nuevo que la use se documenta acá arriba.
 *
 * Si alguna vez hace falta usarla desde una acción del panel, la respuesta
 * correcta es casi siempre `withTenant()`, no esto.
 */
const systemUrl = process.env.SYSTEM_DATABASE_URL
const systemPool = systemUrl
  ? new Pool({ connectionString: systemUrl, max: 5, statement_timeout: 15_000 })
  : null
const systemDb = systemPool ? drizzle(systemPool, { schema }) : null

export async function withSystem<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  if (!systemDb) {
    throw new Error(
      'Falta SYSTEM_DATABASE_URL (usuario crm_worker). Es necesaria para ' +
        'recibir y enviar mensajes de WhatsApp.',
    )
  }
  return systemDb.transaction(async (tx) => fn(tx))
}

/** Cierre ordenado del pool (SIGTERM). */
export async function closeDb(): Promise<void> {
  await pool.end()
}
