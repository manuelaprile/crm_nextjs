/**
 * Alta de una cuenta nueva: un consultorio, una inmobiliaria, un estudio
 * contable. Es todo lo mismo — cambia el rubro.
 *
 * El camino normal hoy es el panel: Plataforma → «Nueva cuenta». Este script
 * queda para automatizar altas y para cuando el panel no levanta.
 *
 * El sistema es multi-tenant: una sola instalación atiende a todos los
 * clientes. Dar de alta una cuenta NO implica desplegar nada — es insertar una
 * fila, aplicar la plantilla del rubro y crear su usuario dueño.
 *
 * Uso:
 *   node --experimental-strip-types scripts/cuenta.ts
 *     <slug> "<Nombre>" <email> "<contraseña>" [--rubro medico]
 *
 * O más cómodo, desde infra/:
 *   ./crm.sh cuenta echeverria "Dr. Echeverría" ana@correo.com "claveLarga"
 *
 * El aislamiento entre cuentas lo garantizan las políticas de la base, no
 * este script: ver packages/db/migrations/0002_rls.sql.
 */
import { existsSync } from 'node:fs'
import { Client } from 'pg'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error('Falta MIGRATE_DATABASE_URL (o DATABASE_URL)')
  process.exit(1)
}

// Los rubros ya no son una lista fija en el código: viven en la tabla
// `verticals` y se validan más abajo, con la conexión abierta. Ver
// 0013_rubros.sql.
const args = process.argv.slice(2)
const flagRubro =
  args.indexOf('--rubro') >= 0 ? args.indexOf('--rubro') : args.indexOf('--vertical')
const rubro = flagRubro >= 0 ? (args[flagRubro + 1] ?? 'medico') : 'medico'
// Ojo con el índice: si el flag no está, indexOf devuelve -1 y "-1 + 1" es 0,
// que descartaría el primer argumento posicional.
const indiceValorRubro = flagRubro >= 0 ? flagRubro + 1 : -1
const posicionales = args.filter(
  (a, i) => !a.startsWith('--') && i !== indiceValorRubro,
)
const [slug, nombre, email, clave] = posicionales

function ayuda(): never {
  console.log(`
  Alta de una cuenta nueva

    cuenta.ts <slug> "<Nombre>" <email> "<contraseña>" [--rubro medico]

  slug        identificador corto, sin espacios ni acentos (echeverria)
  Nombre      el que ve el cliente en el panel ("Dr. Santiago Echeverría")
  email       del usuario dueño
  contraseña  mínimo 8 caracteres
  --rubro     código del rubro (por defecto: medico). Si ponés uno que no
              existe, el script te lista los que hay.

  Ejemplo:
    ./crm.sh cuenta echeverria "Dr. Echeverría" ana@correo.com "claveLarga"

  Lo mismo se hace desde el panel: Plataforma → Nueva cuenta.
`)
  process.exit(0)
}

if (!slug || !nombre || !email || !clave) ayuda()

if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
  console.error('\n  El slug solo admite minúsculas, números y guiones.\n')
  process.exit(1)
}
if (!email.includes('@')) {
  console.error('\n  El email no es válido.\n')
  process.exit(1)
}
if (clave.length < 8) {
  console.error('\n  La contraseña tiene que tener al menos 8 caracteres.\n')
  process.exit(1)
}

const client = new Client({ connectionString: url })

async function main() {
  await client.connect()

  const listo = await client.query(`
    select exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = 'verticals'
    ) as ok
  `)
  if (!listo.rows[0].ok) {
    console.error(`
  Las tablas todavía no existen (o falta la migración 0013).
  Corré primero las migraciones:

    node --experimental-strip-types scripts/migrate.ts
`)
    await client.end()
    process.exit(1)
  }

  // El rubro se valida contra el catálogo, no contra una lista en el código.
  const rubros = await client.query<{ code: string; singular: string }>(
    'select code, singular from verticals where active order by position, singular',
  )
  const elegido = rubros.rows.find((r) => r.code === rubro)
  if (!elegido) {
    const lista = rubros.rows
      .map((r) => `    ${r.code.padEnd(14)} ${r.singular}`)
      .join('\n')
    console.error(
      `\n  No existe el rubro "${rubro}". Los que hay:\n\n${lista}\n\n` +
        '  Para sumar uno nuevo: panel → Plataforma → Nueva cuenta → Otro rubro.\n',
    )
    await client.end()
    process.exit(1)
  }

  const existe = await client.query('select id from tenants where slug = $1', [slug])
  if (existe.rows.length) {
    console.error(`\n  Ya existe una cuenta con el slug "${slug}".\n`)
    await client.end()
    process.exit(1)
  }

  // Todo en una transacción: o queda la cuenta completa con su dueño, o no
  // queda nada. Una cuenta sin usuario es inaccesible y hay que borrarla a
  // mano.
  await client.query('begin')
  try {
    const t = await client.query(
      `insert into tenants (slug, name, vertical, status)
       values ($1, $2, $3, 'active') returning id`,
      [slug, nombre, rubro],
    )
    const tenantId = t.rows[0].id as string

    // Etapas, etiquetas, campos y el prompt del asistente del rubro.
    await client.query('select seed_vertical($1, $2)', [tenantId, rubro])

    const u = await client.query(
      `insert into users (email, name) values ($1, $2)
       on conflict (email) do update set name = excluded.name
       returning id, (xmax = 0) as es_nuevo`,
      [email, nombre],
    )
    const userId = u.rows[0].id as string
    const usuarioNuevo = u.rows[0].es_nuevo as boolean

    // Si el usuario ya existía (atiende varias cuentas), NO se le pisa la
    // contraseña: solo se lo agrega a la cuenta nueva.
    if (usuarioNuevo) {
      await client.query('select set_user_password($1, $2)', [userId, clave])
    }

    await client.query(
      `insert into tenant_users (tenant_id, user_id, role) values ($1, $2, 'owner')
       on conflict (tenant_id, user_id) do update set role = 'owner'`,
      [tenantId, userId],
    )

    await client.query('commit')

    console.log(`
  Cuenta creada.

    Nombre    : ${nombre}
    Slug      : ${slug}
    Rubro     : ${elegido.singular} (${rubro})
    Usuario   : ${email} (dueño)
    ${usuarioNuevo ? 'Contraseña: la que pasaste' : 'Contraseña: la que ya tenía (el usuario ya existía)'}

  Lo que falta hacer desde el panel:

    1. WhatsApp     → conectar el número escaneando el QR
    2. Asistente IA → cargar la clave de API y completar las instrucciones
                      (dirección, horarios, qué ofrece;
                       ver docs/prompt-secretaria.md)

  El asistente arranca APAGADO a propósito: se activa cuando el cliente
  leyó y aprobó el prompt.
`)
  } catch (err) {
    await client.query('rollback')
    throw err
  }

  await client.end()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await client.end().catch(() => {})
  process.exit(1)
})
