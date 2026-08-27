'use server'

/**
 * Prender y apagar funciones por cuenta. Solo superadmin.
 *
 * Todo pasa por funciones `security definer` (ver 0022_interruptores.sql): el
 * rol del panel solo puede LEER `tenant_features`. Que un administrador de un
 * consultorio pudiera prenderse una función a sí mismo vaciaría de sentido
 * todo esto, así que la escritura tiene una sola puerta y verifica el token
 * de sesión del lado de Postgres.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getSession } from './auth'
import { withoutTenant } from './db/client'
import { buscarFuncion } from './funciones'

function volver(codigo: string, tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/superadmin/funciones?f=${encodeURIComponent(codigo)}` +
      `&r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

async function tokenDeSesion(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get('crm_session')?.value
  return token ? createHash('sha256').update(token).digest('hex') : null
}

/** Lo que las tres acciones necesitan antes de tocar nada. */
async function preparar(formData: FormData) {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const codigo = String(formData.get('codigo') ?? '').trim()
  const funcion = buscarFuncion(codigo)
  // Contra el catálogo del código, que es el único que manda: un código que
  // no lee nadie no apaga nada y solo ensucia la base.
  if (!funcion) volver('', 'error', 'Esa función no existe.')

  const hash = await tokenDeSesion()
  if (!hash) volver(codigo, 'error', 'Sesión vencida. Volvé a entrar.')

  return { codigo, funcion, hash }
}

/** Prender o apagar en UNA cuenta. */
export async function cambiarFuncionCuenta(formData: FormData): Promise<void> {
  const { codigo, funcion, hash } = await preparar(formData)
  const tenantId = String(formData.get('tenantId') ?? '')
  const nombre = String(formData.get('nombre') ?? 'la cuenta')
  const activo = String(formData.get('activo') ?? '') === 'si'
  if (!tenantId) volver(codigo, 'error', 'Falta la cuenta.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_funcion_cuenta(${hash}, ${tenantId}::uuid,
                                           ${codigo}, ${activo}) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })
  if (!ok) volver(codigo, 'error', 'No se pudo cambiar.')

  revalidatePath('/superadmin/funciones')
  volver(
    codigo,
    'ok',
    `«${funcion.nombre}» quedó ${activo ? 'prendida' : 'apagada'} en ${nombre}.`,
  )
}

/** Volver al valor por defecto: borra la excepción de esa cuenta. */
export async function funcionPorDefecto(formData: FormData): Promise<void> {
  const { codigo, funcion, hash } = await preparar(formData)
  const tenantId = String(formData.get('tenantId') ?? '')
  const nombre = String(formData.get('nombre') ?? 'la cuenta')
  if (!tenantId) volver(codigo, 'error', 'Falta la cuenta.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_funcion_defecto(${hash}, ${tenantId}::uuid,
                                            ${codigo}) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })
  if (!ok) volver(codigo, 'error', 'No se pudo cambiar.')

  revalidatePath('/superadmin/funciones')
  volver(
    codigo,
    'ok',
    `${nombre} vuelve al valor por defecto de «${funcion.nombre}»: ` +
      `${funcion.porDefecto ? 'prendida' : 'apagada'}.`,
  )
}

/**
 * Prender o apagar en TODAS las cuentas.
 *
 * Pide escribir el código de la función para confirmar. No es adorno: es el
 * botón que toca a todos los clientes a la vez, y un clic de más acá se nota
 * en todas las pantallas al mismo tiempo.
 */
export async function cambiarFuncionTodas(formData: FormData): Promise<void> {
  const { codigo, funcion, hash } = await preparar(formData)
  const activo = String(formData.get('activo') ?? '') === 'si'
  const confirma = String(formData.get('confirma') ?? '').trim()

  if (confirma !== codigo) {
    volver(
      codigo,
      'error',
      `Para aplicarlo en todas las cuentas hay que escribir «${codigo}».`,
    )
  }

  const n = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_funcion_todas(${hash}, ${codigo}, ${activo}) as n`,
    )
    return Number(r.rows[0]?.n ?? -1)
  })
  if (n < 0) volver(codigo, 'error', 'No se pudo aplicar.')

  revalidatePath('/superadmin/funciones')
  volver(
    codigo,
    'ok',
    `«${funcion.nombre}» quedó ${activo ? 'prendida' : 'apagada'} en ` +
      `${n} cuenta${n === 1 ? '' : 's'}.`,
  )
}
