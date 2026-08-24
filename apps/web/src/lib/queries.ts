/**
 * Consultas del panel. TODAS pasan por `withTenant()`.
 *
 * Ninguna página importa el pool ni arma SQL suelta: si una consulta no está
 * acá, no existe. Eso es lo que hace posible auditar el aislamiento leyendo un
 * solo archivo.
 */
import 'server-only'
import { sql } from 'drizzle-orm'
import { withTenant, type TenantContext } from './db/client'

export type Stage = {
  id: string
  key: string
  name: string
  color: string
  position: number
  isWon: boolean
  isLost: boolean
}

export async function getStages(ctx: TenantContext): Promise<Stage[]> {
  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select id, key, name, color, position, is_won, is_lost
        from stages order by position
    `)
    return (res.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      key: String(r.key),
      name: String(r.name),
      color: String(r.color),
      position: Number(r.position),
      isWon: Boolean(r.is_won),
      isLost: Boolean(r.is_lost),
    }))
  })
}

export type ConversationRow = {
  id: string
  participantName: string | null
  participantPhone: string | null
  lastMessageAt: string | null
  lastBody: string | null
  unreadCount: number
  aiEnabled: boolean
  stageName: string | null
  stageColor: string | null
}

export type PaginaConversaciones = {
  filas: ConversationRow[]
  total: number
  pagina: number
  porPagina: number
  paginas: number
}

/**
 * Bandeja paginada.
 *
 * Un consultorio con un año de uso junta miles de conversaciones. Traerlas
 * todas para mostrar las primeras 30 es trabajo tirado: el conteo va en la
 * misma consulta con `count(*) over ()` y el corte lo hace la base.
 */
export async function listConversations(
  ctx: TenantContext,
  opts: {
    search?: string
    stageKey?: string
    pagina?: number
    porPagina?: number
    soloNoLeidas?: boolean
    /** Quién está atendiendo el hilo: la IA o una persona. */
    atiende?: 'ia' | 'humano'
  } = {},
): Promise<PaginaConversaciones> {
  const porPagina = Math.min(100, Math.max(10, opts.porPagina ?? 25))
  const pagina = Math.max(1, opts.pagina ?? 1)
  const offset = (pagina - 1) * porPagina
  const soloNoLeidas = Boolean(opts.soloNoLeidas)
  const atiende = opts.atiende ?? null

  return withTenant(ctx, async (tx) => {
    const search = opts.search?.trim() || null
    const stageKey = opts.stageKey?.trim() || null
    const res = await tx.execute(sql`
      select c.id, c.participant_name, c.participant_phone, c.last_message_at,
             c.unread_count, c.ai_enabled,
             s.name as stage_name, s.color as stage_color,
             (select m.body from messages m
               where m.conversation_id = c.id and m.body is not null
               order by m.created_at desc limit 1) as last_body,
             count(*) over () as total
        from conversations c
   left join contacts ct on ct.id = c.contact_id
   left join stages s on s.id = ct.stage_id
       where c.archived_at is null
         and (${search}::text is null
              or inmutable_unaccent(c.participant_name)
                 ilike inmutable_unaccent('%' || ${search} || '%')
              or c.participant_phone ilike '%' || ${search} || '%')
         and (${stageKey}::text is null or s.key = ${stageKey})
         and (${soloNoLeidas} = false or c.unread_count > 0)
         and (${atiende}::text is null
              or (${atiende} = 'ia' and c.ai_enabled)
              or (${atiende} = 'humano' and not c.ai_enabled))
       order by c.last_message_at desc nulls last
       limit ${porPagina} offset ${offset}
    `)

    const rows = res.rows as Record<string, unknown>[]
    const total = rows.length ? Number(rows[0]!.total) : 0

    return {
      filas: rows.map((r) => ({
        id: String(r.id),
        participantName: r.participant_name ? String(r.participant_name) : null,
        participantPhone: r.participant_phone ? String(r.participant_phone) : null,
        lastMessageAt: r.last_message_at ? String(r.last_message_at) : null,
        lastBody: r.last_body ? String(r.last_body) : null,
        unreadCount: Number(r.unread_count ?? 0),
        aiEnabled: Boolean(r.ai_enabled),
        stageName: r.stage_name ? String(r.stage_name) : null,
        stageColor: r.stage_color ? String(r.stage_color) : null,
      })),
      total,
      pagina,
      porPagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
    }
  })
}

export type MessageRow = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  type: string
  status: string
  senderKind: string
  error: string | null
  createdAt: string
}

export type ConversationDetail = {
  id: string
  participantName: string | null
  participantPhone: string | null
  aiEnabled: boolean
  contactId: string | null
  accountStatus: string
  messages: MessageRow[]
}

export async function getConversation(
  ctx: TenantContext,
  conversationId: string,
): Promise<ConversationDetail | null> {
  return withTenant(ctx, async (tx) => {
    const head = await tx.execute(sql`
      select c.id, c.participant_name, c.participant_phone, c.ai_enabled,
             c.contact_id, ca.status as account_status
        from conversations c
        join channel_accounts ca on ca.id = c.account_id
       where c.id = ${conversationId}
    `)
    const row = head.rows[0] as Record<string, unknown> | undefined
    if (!row) return null

    // Marcar como leída al abrir.
    await tx.execute(sql`
      update conversations set unread_count = 0 where id = ${conversationId}
    `)

    const msgs = await tx.execute(sql`
      select id, direction, body, type, status, sender_kind, error, created_at
        from messages where conversation_id = ${conversationId}
       order by created_at asc limit 300
    `)

    return {
      id: String(row.id),
      participantName: row.participant_name ? String(row.participant_name) : null,
      participantPhone: row.participant_phone ? String(row.participant_phone) : null,
      aiEnabled: Boolean(row.ai_enabled),
      contactId: row.contact_id ? String(row.contact_id) : null,
      accountStatus: String(row.account_status),
      messages: (msgs.rows as Record<string, unknown>[]).map((m) => ({
        id: String(m.id),
        direction: m.direction as 'inbound' | 'outbound',
        body: m.body ? String(m.body) : null,
        type: String(m.type),
        status: String(m.status),
        senderKind: String(m.sender_kind),
        error: m.error ? String(m.error) : null,
        createdAt: String(m.created_at),
      })),
    }
  })
}

export type ContactDetail = {
  id: string
  displayName: string
  phone: string | null
  city: string | null
  province: string | null
  stageId: string | null
  stageName: string | null
  archivado: boolean
  createdAt: string
  tags: { id: string; name: string; color: string }[]
  notes: { id: string; body: string; byAi: boolean; createdAt: string }[]
  history: { toStage: string; byAi: boolean; reason: string | null; createdAt: string }[]
}

export async function getContact(
  ctx: TenantContext,
  contactId: string,
): Promise<ContactDetail | null> {
  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select c.*, s.name as stage_name from contacts c
   left join stages s on s.id = c.stage_id
       where c.id = ${contactId}
    `)
    const row = res.rows[0] as Record<string, unknown> | undefined
    if (!row) return null

    const tagsRes = await tx.execute(sql`
      select t.id, t.name, t.color from contact_tags ct
        join tags t on t.id = ct.tag_id
       where ct.contact_id = ${contactId} order by t.name
    `)
    const notesRes = await tx.execute(sql`
      select id, body, by_ai, created_at from notes
       where contact_id = ${contactId} order by created_at desc limit 50
    `)
    const histRes = await tx.execute(sql`
      select s.name as to_stage, h.by_ai, h.reason, h.created_at
        from stage_history h join stages s on s.id = h.to_stage_id
       where h.contact_id = ${contactId} order by h.created_at desc limit 30
    `)

    return {
      id: String(row.id),
      displayName: String(row.display_name),
      phone: row.phone ? String(row.phone) : null,
      city: row.city ? String(row.city) : null,
      province: row.province ? String(row.province) : null,
      stageId: row.stage_id ? String(row.stage_id) : null,
      stageName: row.stage_name ? String(row.stage_name) : null,
      archivado: Boolean(row.archived_at),
      createdAt: String(row.created_at),
      tags: (tagsRes.rows as Record<string, unknown>[]).map((t) => ({
        id: String(t.id), name: String(t.name), color: String(t.color),
      })),
      notes: (notesRes.rows as Record<string, unknown>[]).map((n) => ({
        id: String(n.id), body: String(n.body),
        byAi: Boolean(n.by_ai), createdAt: String(n.created_at),
      })),
      history: (histRes.rows as Record<string, unknown>[]).map((h) => ({
        toStage: String(h.to_stage), byAi: Boolean(h.by_ai),
        reason: h.reason ? String(h.reason) : null, createdAt: String(h.created_at),
      })),
    }
  })
}

export type PipelineColumn = Stage & {
  contacts: { id: string; displayName: string; city: string | null; phone: string | null }[]
  total: number
}

export async function getPipeline(
  ctx: TenantContext,
  opts: { archivados?: boolean } = {},
): Promise<PipelineColumn[]> {
  const stages = await getStages(ctx)
  const verArchivados = Boolean(opts.archivados)
  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select id, display_name, city, phone, stage_id from contacts
       where (${verArchivados} = true and archived_at is not null)
          or (${verArchivados} = false and archived_at is null)
       order by last_activity_at desc nulls last limit 500
    `)
    const rows = res.rows as Record<string, unknown>[]
    return stages.map((s) => {
      const mine = rows.filter((r) => String(r.stage_id) === s.id)
      return {
        ...s,
        total: mine.length,
        contacts: mine.slice(0, 25).map((r) => ({
          id: String(r.id),
          displayName: String(r.display_name),
          city: r.city ? String(r.city) : null,
          phone: r.phone ? String(r.phone) : null,
        })),
      }
    })
  })
}

// ---------------------------------------------------------------------
// El reporte que pidió el doctor: embudo y zonas
// ---------------------------------------------------------------------

export type FunnelReport = {
  stages: { name: string; color: string; count: number; isWon: boolean }[]
  byCity: { city: string; total: number; operados: number }[]
  totals: { contactos: number; operados: number; conversion: number }
}

export async function getFunnelReport(
  ctx: TenantContext,
  days: number,
): Promise<FunnelReport> {
  return withTenant(ctx, async (tx) => {
    // Embudo ACUMULATIVO, no foto del estado actual.
    //
    // La pregunta del doctor es "de todas las que consultan, cuántas terminan
    // yendo al consultorio y cuántas se operan". Alguien que hoy figura en
    // "Se operó" también pasó por "Consulta inicial": tiene que contar en las
    // dos. Contando solo la etapa actual, el embudo daría al revés.
    //
    // Por eso se calcula sobre `stage_history`: la posición MÁS ALTA que cada
    // contacto alcanzó alguna vez. Las etapas de descarte se excluyen del
    // acumulado y se informan aparte.
    const stageRes = await tx.execute(sql`
      with alcance as (
        select h.contact_id, max(s.position) as max_pos
          from stage_history h
          join stages s on s.id = h.to_stage_id
          join contacts c on c.id = h.contact_id
         where not s.is_lost
           and c.archived_at is null
           and c.created_at > now() - ${`${days} days`}::interval
         group by h.contact_id
      )
      select s.name, s.color, s.is_won, s.position,
             case
               when s.is_lost then (
                 select count(*) from contacts c2
                  where c2.stage_id = s.id and c2.archived_at is null
                    and c2.created_at > now() - ${`${days} days`}::interval
               )
               else (select count(*) from alcance a where a.max_pos >= s.position)
             end as count
        from stages s
       order by s.position
    `)

    // "De qué zona son los que se operaron" — el pedido textual del doctor.
    const cityRes = await tx.execute(sql`
      select coalesce(nullif(c.city, ''), 'Sin zona') as city,
             count(*) as total,
             count(*) filter (where s.is_won) as operados
        from contacts c
   left join stages s on s.id = c.stage_id
       where c.archived_at is null
         and c.created_at > now() - ${`${days} days`}::interval
       group by 1 order by operados desc, total desc limit 20
    `)

    const stages = (stageRes.rows as Record<string, unknown>[]).map((r) => ({
      name: String(r.name),
      color: String(r.color),
      count: Number(r.count),
      isWon: Boolean(r.is_won),
    }))

    // Con el embudo acumulativo, el total es la primera etapa (todos pasaron
    // por ahí), no la suma de las etapas.
    const contactos = stages[0]?.count ?? 0
    const operados = stages.filter((s) => s.isWon).reduce((a, s) => a + s.count, 0)

    return {
      stages,
      byCity: (cityRes.rows as Record<string, unknown>[]).map((r) => ({
        city: String(r.city),
        total: Number(r.total),
        operados: Number(r.operados),
      })),
      totals: {
        contactos,
        operados,
        conversion: contactos ? (operados / contactos) * 100 : 0,
      },
    }
  })
}

export type WhatsAppAccount = {
  id: string
  label: string
  status: string
  phone: string | null
  qr: string | null
  /** Estaba esperando escaneo pero el código ya venció: hay que pedir otro. */
  qrVencido: boolean
  lastError: string | null
  connectedAt: string | null
}

export async function getWhatsAppAccounts(
  ctx: TenantContext,
): Promise<WhatsAppAccount[]> {
  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select id, label, status, phone, qr, last_error, connected_at,
             qr_expires_at
        from channel_accounts where channel = 'whatsapp' order by created_at
    `)
    return (res.rows as Record<string, unknown>[]).map((r) => {
      const expires = r.qr_expires_at ? new Date(String(r.qr_expires_at)) : null
      const qrVigente = expires && expires.getTime() > Date.now()
      return {
        id: String(r.id),
        label: String(r.label),
        status: String(r.status),
        phone: r.phone ? String(r.phone) : null,
        // Un QR vencido no se muestra: escanearlo falla y confunde al cliente.
        qr: qrVigente && r.qr ? String(r.qr) : null,
        qrVencido: String(r.status) === 'qr_pending' && !qrVigente,
        lastError: r.last_error ? String(r.last_error) : null,
        connectedAt: r.connected_at ? String(r.connected_at) : null,
      }
    })
  })
}

// ---------------------------------------------------------------------
// Lista paginada de contactos
// ---------------------------------------------------------------------
/**
 * El tablero es cómodo hasta unos 100 contactos; con 300 o más se vuelve
 * una tira infinita y la página pesa. Esta es la vista que escala: tabla
 * paginada, con búsqueda y filtro por etapa resueltos en la base.
 *
 * El conteo va en la misma consulta con `count(*) over ()`: hacer un SELECT
 * aparte para contar duplica el trabajo del planificador sobre el mismo
 * filtro.
 */
export type ContactoLista = {
  id: string
  displayName: string
  phone: string | null
  city: string | null
  stageName: string | null
  stageColor: string | null
  lastActivityAt: string | null
  createdAt: string
}

export type PaginaContactos = {
  filas: ContactoLista[]
  total: number
  pagina: number
  porPagina: number
  paginas: number
}

export async function listContacts(
  ctx: TenantContext,
  opts: {
    pagina?: number
    porPagina?: number
    buscar?: string
    etapa?: string
    archivados?: boolean
  } = {},
): Promise<PaginaContactos> {
  const porPagina = Math.min(100, Math.max(10, opts.porPagina ?? 25))
  const pagina = Math.max(1, opts.pagina ?? 1)
  const offset = (pagina - 1) * porPagina
  const buscar = opts.buscar?.trim() || null
  const etapa = opts.etapa?.trim() || null
  const archivados = Boolean(opts.archivados)

  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select c.id, c.display_name, c.phone, c.city, c.last_activity_at,
             c.created_at, s.name as stage_name, s.color as stage_color,
             count(*) over () as total
        from contacts c
   left join stages s on s.id = c.stage_id
       where ((${archivados} = true  and c.archived_at is not null)
           or (${archivados} = false and c.archived_at is null))
         -- Búsqueda indiferente a acentos: "cordoba" encuentra "Córdoba".
         -- Ver 0011_busqueda_sin_acentos.sql.
         and (${buscar}::text is null
              or inmutable_unaccent(c.display_name)
                 ilike inmutable_unaccent('%' || ${buscar} || '%')
              or c.phone ilike '%' || ${buscar} || '%'
              or inmutable_unaccent(c.city)
                 ilike inmutable_unaccent('%' || ${buscar} || '%'))
         and (${etapa}::text is null or s.key = ${etapa})
       order by c.last_activity_at desc nulls last, c.created_at desc
       limit ${porPagina} offset ${offset}
    `)

    const rows = res.rows as Record<string, unknown>[]
    const total = rows.length ? Number(rows[0]!.total) : 0

    return {
      filas: rows.map((r) => ({
        id: String(r.id),
        displayName: String(r.display_name),
        phone: r.phone ? String(r.phone) : null,
        city: r.city ? String(r.city) : null,
        stageName: r.stage_name ? String(r.stage_name) : null,
        stageColor: r.stage_color ? String(r.stage_color) : null,
        lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
        createdAt: String(r.created_at),
      })),
      total,
      pagina,
      porPagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
    }
  })
}
