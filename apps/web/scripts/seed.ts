/**
 * Crea el consultorio de demostración con datos realistas.
 *
 *   npm run seed
 *
 * Es idempotente: se puede correr varias veces sin duplicar nada.
 * Los datos son ficticios pero verosímiles: sirven para mostrarle el embudo
 * y los reportes a alguien sin tener que esperar a que entren consultas reales.
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

const EMAIL = process.env.SEED_EMAIL ?? 'demo@consultorio.test'
const PASSWORD = process.env.SEED_PASSWORD ?? 'demo1234'

const NOMBRES = [
  'María Fernández', 'Jorge Aguirre', 'Lucía Benítez', 'Roberto Sosa',
  'Carla Domínguez', 'Andrés Ferreyra', 'Silvina Molina', 'Pablo Ledesma',
  'Natalia Ríos', 'Gustavo Peralta', 'Verónica Cabrera', 'Diego Maldonado',
  'Alejandra Vera', 'Marcelo Ibarra', 'Paula Quiroga', 'Hernán Ocampo',
  'Mariana Suárez', 'Federico Luna', 'Claudia Bustos', 'Sergio Villalba',
  'Gabriela Ponce', 'Nicolás Arias', 'Romina Cáceres', 'Esteban Godoy',
]

const ZONAS = [
  ['Córdoba', 'Córdoba'], ['Villa Carlos Paz', 'Córdoba'],
  ['Río Cuarto', 'Córdoba'], ['Alta Gracia', 'Córdoba'],
  ['Rosario', 'Santa Fe'], ['Santa Fe', 'Santa Fe'],
  ['Buenos Aires', 'CABA'], ['La Plata', 'Buenos Aires'],
]

const CONSULTAS = [
  'Hola, quería saber cuánto sale la consulta',
  'Buenas, me pasaron el contacto. Quería consultar por una cirugía',
  'Hola! Atienden por OSDE?',
  'Buen día, quería pedir un turno',
  'Hola, tengo unos estudios y quería una segunda opinión',
  'Buenas tardes, dónde queda el consultorio?',
  'Hola, cuánto está saliendo la operación aproximadamente?',
  'Me recomendó una amiga que se operó con ustedes',
]

const client = new Client({ connectionString: url })

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!
}

async function main() {
  await client.connect()

  // Las tablas tienen que existir. Sin este chequeo el fallo salía como un
  // stack trace de pg que no dice qué hacer.
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

  await client.query('begin')

  // ---- Consultorio ----
  const tenant = await client.query(
    `insert into tenants (slug, name, vertical, status, plan, max_users, ai_monthly_cost_cap)
     values ('demo', 'Consultorio Demo', 'medico', 'active', 'pro', 5, 20.00)
     on conflict (slug) do update set name = excluded.name
     returning id`,
  )
  const tenantId = tenant.rows[0].id as string
  await client.query('select seed_vertical_medico($1)', [tenantId])

  // ---- Usuario ----
  const user = await client.query(
    `insert into users (email, name) values ($1, 'Secretaria Demo')
     on conflict (email) do update set name = excluded.name
     returning id`,
    [EMAIL],
  )
  const userId = user.rows[0].id as string
  await client.query('select set_user_password($1, $2)', [userId, PASSWORD])
  await client.query(
    `insert into tenant_users (tenant_id, user_id, role) values ($1, $2, 'owner')
     on conflict (tenant_id, user_id) do update set role = 'owner'`,
    [tenantId, userId],
  )

  // ---- Cuenta de WhatsApp (sin conectar) ----
  const account = await client.query(
    `insert into channel_accounts (tenant_id, label, status)
     values ($1, 'Principal', 'disconnected')
     on conflict do nothing
     returning id`,
    [tenantId],
  )
  const accountId =
    (account.rows[0]?.id as string) ??
    (
      await client.query(
        `select id from channel_accounts where tenant_id = $1 limit 1`,
        [tenantId],
      )
    ).rows[0].id

  // ---- Etapas y etiquetas existentes ----
  const stages = await client.query(
    `select id, key from stages where tenant_id = $1 order by position`,
    [tenantId],
  )
  const stageBy = Object.fromEntries(
    stages.rows.map((r: { id: string; key: string }) => [r.key, r.id]),
  )
  const tags = await client.query(
    `select id, name from tags where tenant_id = $1`,
    [tenantId],
  )

  // Distribución realista de un embudo: muchos arriba, pocos abajo.
  const REPARTO = [
    ...Array(10).fill('consulta'),
    ...Array(6).fill('interesado'),
    ...Array(4).fill('consultorio'),
    ...Array(3).fill('operado'),
    ...Array(1).fill('descartado'),
  ]

  let creados = 0
  for (let i = 0; i < NOMBRES.length; i++) {
    const nombre = NOMBRES[i]!
    const [city, province] = pick(ZONAS, i)
    const stageKey = pick(REPARTO, i)
    const phone = `54935${String(10000000 + i * 137).slice(0, 8)}`
    const jid = `${phone}@s.whatsapp.net`
    const diasAtras = Math.floor((i * 73) % 60)

    const existing = await client.query(
      `select contact_id from contact_identities
        where tenant_id = $1 and channel = 'whatsapp' and external_id = $2`,
      [tenantId, jid],
    )
    if (existing.rows.length) continue

    const contact = await client.query(
      `insert into contacts
         (tenant_id, display_name, phone, city, province, source, stage_id,
          created_at, last_activity_at, stage_since)
       values ($1,$2,$3,$4,$5,'whatsapp',$6,
               now() - ($7 || ' days')::interval,
               now() - ($7 || ' days')::interval,
               now() - ($7 || ' days')::interval)
       returning id`,
      [tenantId, nombre, phone, city, province, stageBy[stageKey], diasAtras],
    )
    const contactId = contact.rows[0].id as string

    await client.query(
      `insert into contact_identities (tenant_id, contact_id, channel, external_id, handle)
       values ($1,$2,'whatsapp',$3,$4)`,
      [tenantId, contactId, jid, phone],
    )
    await client.query(
      `insert into stage_history (tenant_id, contact_id, to_stage_id, reason, created_at)
       values ($1,$2,$3,'Primer contacto por WhatsApp', now() - ($4 || ' days')::interval)`,
      [tenantId, contactId, stageBy[stageKey], diasAtras],
    )

    if (tags.rows.length) {
      const tag = pick(tags.rows, i)
      await client.query(
        `insert into contact_tags (tenant_id, contact_id, tag_id)
         values ($1,$2,$3) on conflict do nothing`,
        [tenantId, contactId, tag.id],
      )
    }

    // ---- Conversación con mensajes ----
    const conv = await client.query(
      `insert into conversations
         (tenant_id, channel, provider, account_id, external_id, contact_id,
          participant_name, participant_phone, last_message_at, last_inbound_at,
          unread_count, ai_enabled, created_at)
       values ($1,'whatsapp','baileys',$2,$3,$4,$5,$6,
               now() - ($7 || ' days')::interval,
               now() - ($7 || ' days')::interval,
               $8, true, now() - ($7 || ' days')::interval)
       on conflict (provider, external_id) do nothing
       returning id`,
      [tenantId, accountId, jid, contactId, nombre, phone, diasAtras, i % 3 === 0 ? 1 : 0],
    )
    if (!conv.rows.length) continue
    const convId = conv.rows[0].id as string

    const consulta = pick(CONSULTAS, i)
    await client.query(
      `insert into messages
         (tenant_id, conversation_id, channel, provider, external_id, direction,
          type, body, status, sender_kind, created_at, sent_at)
       values ($1,$2,'whatsapp','baileys',$3,'inbound','text',$4,'delivered','contact',
               now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval)`,
      [tenantId, convId, `seed-in-${i}`, consulta, diasAtras],
    )
    await client.query(
      `insert into messages
         (tenant_id, conversation_id, channel, provider, external_id, direction,
          type, body, status, sender_kind, created_at, sent_at)
       values ($1,$2,'whatsapp','baileys',$3,'outbound','text',$4,'delivered','ai',
               now() - ($5 || ' days')::interval + interval '2 minutes',
               now() - ($5 || ' days')::interval + interval '2 minutes')`,
      [
        tenantId, convId, `seed-out-${i}`,
        'Hola! Gracias por escribir. Para poder ayudarte mejor, ¿me contás por qué motivo consultás?',
        diasAtras,
      ],
    )

    if (stageKey === 'operado' || stageKey === 'consultorio') {
      await client.query(
        `insert into notes (tenant_id, contact_id, body, created_at)
         values ($1,$2,$3, now() - ($4 || ' days')::interval)`,
        [
          tenantId, contactId,
          stageKey === 'operado'
            ? 'Cirugía realizada. Cobertura particular.'
            : 'Vino al consultorio. Quedó en confirmar fecha.',
          Math.max(0, diasAtras - 5),
        ],
      )
    }
    creados++
  }

  await client.query('commit')

  console.log('\n  Datos de demostración listos.\n')
  console.log(`  Consultorio : Consultorio Demo`)
  console.log(`  Contactos   : ${creados} nuevos`)
  console.log(`  ─────────────────────────────────`)
  console.log(`  Usuario     : ${EMAIL}`)
  console.log(`  Contraseña  : ${PASSWORD}`)
  console.log(`  ─────────────────────────────────\n`)

  await client.end()
}

main().catch(async (err) => {
  await client.query('rollback').catch(() => {})
  console.error(err)
  process.exit(1)
})
