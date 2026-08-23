/**
 * Bajas: borrar una cuenta entera o un usuario.
 *
 * Es la operación más peligrosa del sistema, así que está hecha para que sea
 * difícil equivocarse:
 *
 *  - **Sin `--si` no borra nada.** Muestra exactamente qué se llevaría por
 *    delante y termina. Hay que volver a correrlo con el flag.
 *  - Borrar una cuenta borra EN CASCADA sus contactos, conversaciones,
 *    mensajes, notas y la sesión de WhatsApp. No hay papelera.
 *  - Para un usuario casi siempre conviene `--deshabilitar` en vez de borrar:
 *    deja de poder entrar, pero el historial de quién hizo qué sigue con su
 *    nombre. Borrarlo deja esas filas sin autor.
 *
 * Uso:
 *   node --experimental-strip-types scripts/borrar.ts cuenta  <slug>  [--si]
 *   node --experimental-strip-types scripts/borrar.ts usuario <email> [--si]
 *   node --experimental-strip-types scripts/borrar.ts usuario <email> --deshabilitar
 *   node --experimental-strip-types scripts/borrar.ts usuario <email> --habilitar
 *
 * Desde infra/:
 *   ./crm.sh borrar cuenta echeverria
 *   ./crm.sh borrar cuenta echeverria --si
 */
import { existsSync } from 'node:fs'
import { Client } from 'pg'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error('Falta MIGRATE_DATABASE_URL (o DATABASE_URL)')
  process.exit(1)
}

const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith('--'))
const [que, objetivo] = args.filter((a) => !a.startsWith('--'))
const confirmado = flags.includes('--si')
const deshabilitar = flags.includes('--deshabilitar')
const habilitar = flags.includes('--habilitar')

function ayuda(): never {
  console.log(`
  Bajas

    borrar.ts cuenta <slug>                Simula: muestra qué se borraría
    borrar.ts cuenta <slug> --si           Borra la cuenta y TODOS sus datos

    borrar.ts usuario <email>              Simula
    borrar.ts usuario <email> --si         Borra el usuario
    borrar.ts usuario <email> --deshabilitar   No lo borra: le corta el acceso
    borrar.ts usuario <email> --habilitar      Le devuelve el acceso

  Sin --si no se toca nada. Antes de una baja de verdad, hacé un backup:
  ./crm.sh backup
`)
  process.exit(0)
}

if (!que || !objetivo) ayuda()
if (que !== 'cuenta' && que !== 'usuario') ayuda()

const client = new Client({ connectionString: url })

function titulo(t: string) {
  console.log(`\n  ${t}\n  ${'-'.repeat(t.length)}`)
}

async function borrarCuenta(slug: string) {
  const t = await client.query(
    `select t.id, t.name, t.status, coalesce(v.singular, t.vertical) as rubro
       from tenants t left join verticals v on v.code = t.vertical
      where t.slug = $1`,
    [slug],
  )
  if (!t.rows.length) {
    const otras = await client.query('select slug from tenants order by slug')
    console.error(
      `\n  No existe ninguna cuenta con el slug "${slug}".\n\n  Las que hay:\n` +
        otras.rows.map((r: { slug: string }) => `    ${r.slug}`).join('\n') +
        '\n',
    )
    process.exit(1)
  }
  const { id, name, status, rubro } = t.rows[0]

  // El recuento va antes del borrado a propósito: es lo único que le permite
  // a alguien darse cuenta de que apuntó al slug equivocado.
  const n = await client.query(
    `select
       (select count(*) from tenant_users   where tenant_id = $1) as usuarios,
       (select count(*) from contacts       where tenant_id = $1) as contactos,
       (select count(*) from conversations  where tenant_id = $1) as conversaciones,
       (select count(*) from messages       where tenant_id = $1) as mensajes,
       (select count(*) from notes          where tenant_id = $1) as notas,
       (select count(*) from channel_accounts where tenant_id = $1) as numeros`,
    [id],
  )
  const c = n.rows[0]

  titulo(`${name}  (${rubro}, ${status})`)
  console.log(`    usuarios vinculados : ${c.usuarios}`)
  console.log(`    contactos           : ${c.contactos}`)
  console.log(`    conversaciones      : ${c.conversaciones}`)
  console.log(`    mensajes            : ${c.mensajes}`)
  console.log(`    notas               : ${c.notas}`)
  console.log(`    números de WhatsApp : ${c.numeros}`)

  if (!confirmado) {
    console.log(`
  SIMULACIÓN — no se borró nada.

  Si de verdad querés borrar todo eso, y no hay forma de recuperarlo:

    ./crm.sh backup
    ./crm.sh borrar cuenta ${slug} --si

  Si lo que querés es que el cliente deje de entrar pero conservar los datos
  (dejó de pagar, se fue de vacaciones), suspendela en vez de borrarla:

    ./crm.sh sql "update tenants set status='suspended' where slug='${slug}'"

  Una cuenta suspendida no deja entrar a nadie y se puede reactivar poniendo
  status='active'.
`)
    return
  }

  await client.query('begin')
  try {
    // Todo lo demás cae por las claves foráneas (on delete cascade). Ver
    // 0001_core.sql: es la razón por la que esto es una sola línea.
    await client.query('delete from tenants where id = $1', [id])

    // Usuarios que quedaron sin ninguna cuenta: no son huérfanos peligrosos,
    // pero conviene avisarlos para que no queden sueltos en la base.
    const sueltos = await client.query(
      `select u.email from users u
        where u.is_superadmin = false
          and not exists (select 1 from tenant_users tu where tu.user_id = u.id)`,
    )
    await client.query('commit')

    console.log(`\n  Borrada: ${name}\n`)
    if (sueltos.rows.length) {
      console.log('  Quedaron usuarios sin ninguna cuenta asignada:')
      for (const r of sueltos.rows as { email: string }[]) {
        console.log(`    ${r.email}   →  ./crm.sh borrar usuario ${r.email} --si`)
      }
      console.log('')
    }
    if (Number(c.numeros) > 0) {
      console.log(
        '  Tenía WhatsApp conectado: reiniciá el worker para que suelte la\n' +
          '  sesión que todavía tiene en memoria.\n\n    ./crm.sh reiniciar\n',
      )
    }
  } catch (err) {
    await client.query('rollback')
    throw err
  }
}

async function borrarUsuario(email: string) {
  const u = await client.query(
    `select id, name, email, is_superadmin, disabled_at from users where email = $1`,
    [email],
  )
  if (!u.rows.length) {
    console.error(`\n  No existe ningún usuario con el email "${email}".\n`)
    process.exit(1)
  }
  const { id, name, is_superadmin, disabled_at } = u.rows[0]

  const donde = await client.query(
    `select t.slug, t.name, tu.role from tenant_users tu
       join tenants t on t.id = tu.tenant_id
      where tu.user_id = $1 order by t.name`,
    [id],
  )
  const actividad = await client.query(
    `select count(*)::int as n from audit_log where actor_user_id = $1`,
    [id],
  )

  titulo(`${name}  <${email}>`)
  console.log(`    superadmin  : ${is_superadmin ? 'sí' : 'no'}`)
  console.log(`    estado      : ${disabled_at ? 'deshabilitado' : 'activo'}`)
  console.log(
    `    cuentas     : ${
      donde.rows.length
        ? donde.rows.map((r: { name: string; role: string }) => `${r.name} (${r.role})`).join(', ')
        : 'ninguna'
    }`,
  )
  console.log(`    acciones registradas en auditoría : ${actividad.rows[0].n}`)

  if (habilitar) {
    await client.query('update users set disabled_at = null where id = $1', [id])
    console.log(`\n  ${email} puede volver a entrar.\n`)
    return
  }

  if (deshabilitar) {
    await client.query('update users set disabled_at = now() where id = $1', [id])
    const s = await client.query('delete from sessions where user_id = $1', [id])
    console.log(
      `\n  ${email} ya no puede entrar. Se cerraron ${s.rowCount} sesión(es).\n` +
        `  Sigue existiendo, así que la auditoría conserva su nombre.\n` +
        `  Para revertirlo: ./crm.sh borrar usuario ${email} --habilitar\n`,
    )
    return
  }

  if (!confirmado) {
    console.log(`
  SIMULACIÓN — no se borró nada.

  Para borrarlo de verdad:

    ./crm.sh borrar usuario ${email} --si
${
  Number(actividad.rows[0].n) > 0
    ? `
  Ojo: tiene ${actividad.rows[0].n} acción(es) en la auditoría. Si lo borrás,
  esas filas quedan sin autor. Casi siempre es mejor cortarle el acceso y
  dejarlo existir:

    ./crm.sh borrar usuario ${email} --deshabilitar
`
    : `
  Si solo querés que no pueda entrar, sin borrarlo:

    ./crm.sh borrar usuario ${email} --deshabilitar
`
}`)
    return
  }

  // `tenant_users` y `sessions` caen por cascada; las filas de auditoría y los
  // mensajes que escribió quedan, con el autor en null.
  await client.query('delete from users where id = $1', [id])
  console.log(`\n  Borrado: ${email}\n`)
}

async function main() {
  await client.connect()
  if (que === 'cuenta') await borrarCuenta(objetivo!)
  else await borrarUsuario(objetivo!)
  await client.end()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await client.query('rollback').catch(() => {})
  await client.end().catch(() => {})
  process.exit(1)
})
