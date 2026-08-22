/**
 * Alta y gestión de usuarios desde la línea de comandos.
 *
 * Se hace por script y no por pantalla a propósito: el primer superadmin
 * tiene que existir antes de que haya alguien con permisos para crearlo.
 * Es el mismo problema del huevo y la gallina que resuelve `wp user create`
 * en WordPress.
 *
 * Uso:
 *   npx tsx scripts/usuario.ts crear <email> <nombre> <contraseña> [--superadmin]
 *   npx tsx scripts/usuario.ts asignar <email> <slug-consultorio> <rol>
 *   npx tsx scripts/usuario.ts clave <email> <contraseña-nueva>
 *   npx tsx scripts/usuario.ts listar
 *   npx tsx scripts/usuario.ts consultorios
 *
 * Roles: owner | admin | agent
 *
 * Se conecta como crm_owner (MIGRATE_DATABASE_URL): crear usuarios y
 * asignarlos a consultorios está por encima de lo que puede hacer la app.
 */
import { existsSync } from 'node:fs'
import { Client } from 'pg'

// Los scripts corren fuera de Next, que es quien lee .env.local solo.
// `loadEnvFile` viene con Node 20.12+, sin dependencias.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error('Falta MIGRATE_DATABASE_URL (o DATABASE_URL)')
  process.exit(1)
}

const client = new Client({ connectionString: url })
const [, , comando, ...args] = process.argv

function ayuda(): never {
  console.log(`
  Gestión de usuarios

    crear <email> <nombre> <contraseña> [--superadmin]
        Crea un usuario. Con --superadmin le da acceso al panel de
        administración de la plataforma.

    asignar <email> <slug-consultorio> <rol>
        Lo vincula a un consultorio. Roles: owner, admin, agent.

    clave <email> <contraseña-nueva>
        Cambia la contraseña.

    superadmin <email> on|off
        Da o saca el permiso de superadministrador.

    listar
        Muestra todos los usuarios y a qué consultorios pertenecen.

    consultorios
        Muestra los consultorios existentes con su slug.
`)
  process.exit(0)
}

async function main() {
  if (!comando || comando === 'ayuda' || comando === '--help') ayuda()
  await client.connect()

  switch (comando) {
    case 'crear': {
      const [email, nombre, pass] = args
      const esSuper = args.includes('--superadmin')
      if (!email || !nombre || !pass) {
        console.error('Uso: crear <email> <nombre> <contraseña> [--superadmin]')
        process.exit(1)
      }
      if (pass.length < 8) {
        console.error('La contraseña tiene que tener al menos 8 caracteres.')
        process.exit(1)
      }
      const r = await client.query(
        `insert into users (email, name, is_superadmin) values ($1, $2, $3)
         on conflict (email) do update set name = excluded.name,
                                           is_superadmin = excluded.is_superadmin
         returning id`,
        [email, nombre, esSuper],
      )
      const id = r.rows[0].id as string
      await client.query('select set_user_password($1, $2)', [id, pass])
      console.log(`\n  Usuario listo`)
      console.log(`  email       : ${email}`)
      console.log(`  superadmin  : ${esSuper ? 'sí' : 'no'}`)
      if (!esSuper) {
        console.log(
          `\n  Falta asignarlo a un consultorio:\n` +
            `    npx tsx scripts/usuario.ts asignar ${email} <slug> owner\n`,
        )
      }
      break
    }

    case 'asignar': {
      const [email, slug, rol] = args
      if (!email || !slug || !rol) {
        console.error('Uso: asignar <email> <slug-consultorio> <rol>')
        process.exit(1)
      }
      if (!['owner', 'admin', 'agent'].includes(rol)) {
        console.error('Rol inválido. Usá: owner, admin o agent.')
        process.exit(1)
      }
      const u = await client.query('select id from users where email = $1', [email])
      if (!u.rows.length) {
        console.error(`No existe el usuario ${email}.`)
        process.exit(1)
      }
      const t = await client.query('select id, name from tenants where slug = $1', [slug])
      if (!t.rows.length) {
        console.error(`No existe el consultorio con slug "${slug}".`)
        console.error('Vé los disponibles con: npx tsx scripts/usuario.ts consultorios')
        process.exit(1)
      }
      await client.query(
        `insert into tenant_users (tenant_id, user_id, role) values ($1, $2, $3)
         on conflict (tenant_id, user_id) do update set role = excluded.role`,
        [t.rows[0].id, u.rows[0].id, rol],
      )
      console.log(`\n  ${email} → ${t.rows[0].name} como ${rol}\n`)
      break
    }

    case 'clave': {
      const [email, pass] = args
      if (!email || !pass) {
        console.error('Uso: clave <email> <contraseña-nueva>')
        process.exit(1)
      }
      if (pass.length < 8) {
        console.error('La contraseña tiene que tener al menos 8 caracteres.')
        process.exit(1)
      }
      const u = await client.query('select id from users where email = $1', [email])
      if (!u.rows.length) {
        console.error(`No existe el usuario ${email}.`)
        process.exit(1)
      }
      await client.query('select set_user_password($1, $2)', [u.rows[0].id, pass])
      // Cambiar la contraseña cierra todas las sesiones abiertas: si se
      // cambió porque se filtró, dejarlas vivas no sirve de nada.
      const s = await client.query('delete from sessions where user_id = $1', [
        u.rows[0].id,
      ])
      console.log(
        `\n  Contraseña actualizada. Se cerraron ${s.rowCount} sesión(es) abierta(s).\n`,
      )
      break
    }

    case 'superadmin': {
      const [email, estado] = args
      if (!email || !['on', 'off'].includes(estado ?? '')) {
        console.error('Uso: superadmin <email> on|off')
        process.exit(1)
      }
      const r = await client.query(
        'update users set is_superadmin = $2 where email = $1 returning email',
        [email, estado === 'on'],
      )
      if (!r.rows.length) {
        console.error(`No existe el usuario ${email}.`)
        process.exit(1)
      }
      console.log(
        `\n  ${email}: superadmin ${estado === 'on' ? 'ACTIVADO' : 'desactivado'}\n`,
      )
      break
    }

    case 'listar': {
      const r = await client.query(`
        select u.email, u.name, u.is_superadmin,
               coalesce(string_agg(t.name || ' (' || tu.role || ')', ', '
                        order by t.name), '—') as consultorios
          from users u
     left join tenant_users tu on tu.user_id = u.id
     left join tenants t on t.id = tu.tenant_id
         group by u.id, u.email, u.name, u.is_superadmin
         order by u.is_superadmin desc, u.email
      `)
      console.log('')
      for (const row of r.rows) {
        const marca = row.is_superadmin ? '★ ' : '  '
        console.log(`${marca}${row.email}  —  ${row.name}`)
        console.log(`     ${row.consultorios}`)
      }
      console.log(`\n  ★ = superadministrador\n`)
      break
    }

    case 'consultorios': {
      const r = await client.query(`
        select t.slug, t.name, t.vertical, t.status,
               (select count(*) from tenant_users tu where tu.tenant_id = t.id) as usuarios
          from tenants t order by t.name
      `)
      console.log('')
      for (const row of r.rows) {
        console.log(
          `  ${String(row.slug).padEnd(16)} ${String(row.name).padEnd(30)} ` +
            `${row.vertical} · ${row.status} · ${row.usuarios} usuario(s)`,
        )
      }
      console.log('')
      break
    }

    default:
      console.error(`Comando desconocido: ${comando}`)
      ayuda()
  }

  await client.end()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await client.end().catch(() => {})
  process.exit(1)
})
