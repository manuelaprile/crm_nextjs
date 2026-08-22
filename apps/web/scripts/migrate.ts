/**
 * Aplica las migraciones en orden y lleva registro de cuáles ya corrieron.
 *
 * Se conecta como crm_owner (dueño de las tablas), NO como crm_app: la app no
 * tiene ni debe tener permisos para cambiar el schema.
 *
 *   npm run migrate
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { Client } from 'pg'

// Los scripts corren fuera de Next, que es quien lee .env.local solo.
// `loadEnvFile` viene con Node 20.12+, sin dependencias.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'packages', 'db', 'migrations')

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error('Falta MIGRATE_DATABASE_URL (o DATABASE_URL)')
  process.exit(1)
}

const client = new Client({ connectionString: url })

async function main() {
  await client.connect()

  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const applied = new Set(
    (await client.query('select name from _migrations')).rows.map(
      (r: { name: string }) => r.name,
    ),
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let count = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ya aplicada   ${file}`)
      continue
    }
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    process.stdout.write(`  aplicando     ${file} … `)
    try {
      // Cada migración en su propia transacción: si falla, no deja el schema
      // a medio aplicar.
      await client.query('begin')
      await client.query(sqlText)
      await client.query('insert into _migrations (name) values ($1)', [file])
      await client.query('commit')
      console.log('OK')
      count++
    } catch (err) {
      await client.query('rollback')
      console.log('FALLÓ')
      console.error(err)
      process.exit(1)
    }
  }

  console.log(
    count ? `\n${count} migración(es) aplicada(s).` : '\nSin cambios pendientes.',
  )
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
