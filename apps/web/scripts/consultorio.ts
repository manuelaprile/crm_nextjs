/**
 * Alta de un consultorio nuevo.
 *
 * El sistema es multi-tenant: una sola instalación atiende a todos los
 * clientes. Dar de alta uno nuevo NO implica desplegar nada — es insertar
 * una fila, aplicar la plantilla del vertical y crear su usuario dueño.
 *
 * Uso:
 *   node --experimental-strip-types scripts/consultorio.ts \
 *     <slug> "<Nombre>" <email> "<contraseña>" [--vertical medico]
 *
 * O más cómodo, desde infra/:
 *   ./crm.sh consultorio echeverria "Dr. Echeverría" ana@correo.com "claveLarga"
 *
 * El aislamiento entre consultorios lo garantizan las políticas de la base,
 * no este script: ver packages/db/migrations/0002_rls.sql.
 */
import { existsSync } from 'node:fs'
import { Client } from 'pg'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error('Falta MIGRATE_DATABASE_URL (o DATABASE_URL)')
  process.exit(1)
}

const VERTICALES = ['medico', 'ecommerce', 'colegio', 'generico']

const args = process.argv.slice(2)
const flagVertical = args.indexOf('--vertical')
const vertical = flagVertical >= 0 ? (args[flagVertical + 1] ?? 'medico') : 'medico'
// Ojo con el índice: si el flag no está, indexOf devuelve -1 y "-1 + 1" es 0,
// que descartaría el primer argumento posicional.
const indiceValorVertical = flagVertical >= 0 ? flagVertical + 1 : -1
const posicionales = args.filter(
  (a, i) => !a.startsWith('--') && i !== indiceValorVertical,
)
const [slug, nombre, email, clave] = posicionales

function ayuda(): never {
  console.log(`
  Alta de un consultorio nuevo

    consultorio.ts <slug> "<Nombre>" <email> "<contraseña>" [--vertical medico]

  slug        identificador corto, sin espacios ni acentos (echeverria)
  Nombre      el que ve el cliente en el panel ("Dr. Santiago Echeverría")
  email       del usuario dueño
  contraseña  mínimo 8 caracteres
  --vertical  ${VERTICALES.join(' | ')}   (por defecto: medico)

  Ejemplo:
    ./crm.sh consultorio echeverria "Dr. Echeverría" ana@correo.com "claveLarga"
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
if (!VERTICALES.includes(vertical)) {
  console.error(`\n  Vertical desconocido. Opciones: ${VERTICALES.join(', ')}\n`)
  process.exit(1)
}

const client = new Client({ connectionString: url })

async function main() {
  await client.connect()

  const listo = await client.query(`
    select exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = 'tenants'
    ) as ok
  `)
  if (!listo.rows[0].ok) {
    console.error(`
  Las tablas todavía no existen.
  Corré primero las migraciones:

    node --experimental-strip-types scripts/migrate.ts
`)
    await client.end()
    process.exit(1)
  }

  const existe = await client.query('select id from tenants where slug = $1', [slug])
  if (existe.rows.length) {
    console.error(`\n  Ya existe un consultorio con el slug "${slug}".\n`)
    await client.end()
    process.exit(1)
  }

  // Todo en una transacción: o queda el consultorio completo con su dueño,
  // o no queda nada. Un consultorio sin usuario es inaccesible y hay que
  // borrarlo a mano.
  await client.query('begin')
  try {
    const t = await client.query(
      `insert into tenants (slug, name, vertical, status)
       values ($1, $2, $3, 'active') returning id`,
      [slug, nombre, vertical],
    )
    const tenantId = t.rows[0].id as string

    // Etapas, etiquetas, campos y el prompt del asistente del vertical.
    if (vertical === 'medico') {
      await client.query('select seed_vertical_medico($1)', [tenantId])
    }

    const u = await client.query(
      `insert into users (email, name) values ($1, $2)
       on conflict (email) do update set name = excluded.name
       returning id, (xmax = 0) as es_nuevo`,
      [email, nombre],
    )
    const userId = u.rows[0].id as string
    const usuarioNuevo = u.rows[0].es_nuevo as boolean

    // Si el usuario ya existía (atiende varios consultorios), NO se le pisa
    // la contraseña: solo se lo agrega al consultorio nuevo.
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
  Consultorio creado.

    Nombre    : ${nombre}
    Slug      : ${slug}
    Vertical  : ${vertical}
    Usuario   : ${email} (dueño)
    ${usuarioNuevo ? 'Contraseña: la que pasaste' : 'Contraseña: la que ya tenía (el usuario ya existía)'}

  Lo que falta hacer desde el panel:

    1. WhatsApp    → conectar el número escaneando el QR
    2. Asistente IA → cargar la clave de API y completar las instrucciones
                      (los datos del consultorio: dirección, horarios,
                       obras sociales; ver docs/prompt-secretaria.md)

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
