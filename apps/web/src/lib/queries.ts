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

/**
 * Un id que llega por la URL puede ser cualquier cosa. Se valida antes de
 * meterlo en la consulta: si no tiene forma de uuid, el filtro no se aplica
 * en vez de romper la pantalla con un error de Postgres.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  /**
   * Cuándo viene, si tiene un turno por delante.
   *
   * Se resuelve en la MISMA consulta y no con una segunda vuelta: la lista se
   * vuelve a dibujar en cada latido de la bandeja, y una consulta por
   * conversación se nota enseguida.
   */
  proximoTurno: string | null
  stageName: string | null
  stageColor: string | null
  /** Quién la tiene a cargo. null = sin asignar, que es como entra todo. */
  asignadoA: string | null
  asignadoNombre: string | null
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
    /**
     * Qué se muestra: quién atiende el hilo, o los que tienen turno.
     * Van juntos en un solo filtro porque en pantalla son una sola fila de
     * solapas, y elegir una reemplaza a la otra.
     */
    atiende?: 'ia' | 'humano' | 'visita'
    /**
     * De quién son. Un id de usuario, o `'sin'` para las que no tiene nadie.
     *
     * Es un filtro aparte de `atiende` y no otra solapa de la misma fila:
     * "las de Ana" y "las que atiende la IA" son preguntas distintas y se
     * combinan. Ver la bandeja para el porqué de que se elijan por separado.
     */
    asignado?: string
  } = {},
): Promise<PaginaConversaciones> {
  const porPagina = Math.min(100, Math.max(10, opts.porPagina ?? 25))
  const pagina = Math.max(1, opts.pagina ?? 1)
  const offset = (pagina - 1) * porPagina
  const soloNoLeidas = Boolean(opts.soloNoLeidas)
  const atiende = opts.atiende ?? null
  const asignado = opts.asignado?.trim() || null
  const sinAsignar = asignado === 'sin'
  // Un valor que no sea 'sin' tiene que ser un id: si llega cualquier cosa
  // por la URL, el filtro no se aplica en vez de reventar la consulta.
  const deUsuario = !sinAsignar && asignado && UUID_RE.test(asignado) ? asignado : null

  return withTenant(ctx, async (tx) => {
    const search = opts.search?.trim() || null
    const stageKey = opts.stageKey?.trim() || null
    const res = await tx.execute(sql`
      select c.id, c.participant_name, c.participant_phone, c.last_message_at,
             c.unread_count, c.ai_enabled, c.assigned_user_id,
             au.name as assigned_name,
             s.name as stage_name, s.color as stage_color,
             (select m.body from messages m
               where m.conversation_id = c.id and m.body is not null
               order by m.created_at desc limit 1) as last_body,
             (select min(a.starts_at) from appointments a
               where a.contact_id = c.contact_id
                 and a.status = 'programada' and a.ends_at >= now())
               as proximo_turno,
             count(*) over () as total
        from conversations c
   left join contacts ct on ct.id = c.contact_id
   left join stages s on s.id = ct.stage_id
   left join users au on au.id = c.assigned_user_id
       where c.archived_at is null
         and (${search}::text is null
              or inmutable_unaccent(c.participant_name)
                 ilike inmutable_unaccent('%' || ${search} || '%')
              or c.participant_phone ilike '%' || ${search} || '%')
         and (${stageKey}::text is null or s.key = ${stageKey})
         and (${soloNoLeidas} = false or c.unread_count > 0)
         and (${atiende}::text is null
              or (${atiende} = 'ia' and c.ai_enabled)
              or (${atiende} = 'humano' and not c.ai_enabled)
              or (${atiende} = 'visita' and exists (
                    select 1 from appointments a
                     where a.contact_id = c.contact_id
                       and a.status = 'programada' and a.ends_at >= now())))
         and (${sinAsignar} = false or c.assigned_user_id is null)
         and (${deUsuario}::uuid is null or c.assigned_user_id = ${deUsuario})
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
        proximoTurno: r.proximo_turno ? String(r.proximo_turno) : null,
        stageName: r.stage_name ? String(r.stage_name) : null,
        stageColor: r.stage_color ? String(r.stage_color) : null,
        asignadoA: r.assigned_user_id ? String(r.assigned_user_id) : null,
        asignadoNombre: r.assigned_name ? String(r.assigned_name) : null,
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
  /** Quién la tiene a cargo. null = sin asignar. */
  asignadoA: string | null
  asignadoNombre: string | null
  messages: MessageRow[]
}

export async function getConversation(
  ctx: TenantContext,
  conversationId: string,
): Promise<ConversationDetail | null> {
  return withTenant(ctx, async (tx) => {
    const head = await tx.execute(sql`
      select c.id, c.participant_name, c.participant_phone, c.ai_enabled,
             c.contact_id, c.assigned_user_id, au.name as assigned_name,
             ca.status as account_status
        from conversations c
        join channel_accounts ca on ca.id = c.account_id
   left join users au on au.id = c.assigned_user_id
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
      asignadoA: row.assigned_user_id ? String(row.assigned_user_id) : null,
      asignadoNombre: row.assigned_name ? String(row.assigned_name) : null,
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
  /** De qué es la consulta, en una línea. */
  asunto: string | null
  responsableId: string | null
  responsableNombre: string | null
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
      select c.*, s.name as stage_name, u.name as owner_name
        from contacts c
   left join stages s on s.id = c.stage_id
   left join users u on u.id = c.owner_user_id
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
      asunto: row.asunto ? String(row.asunto) : null,
      responsableId: row.owner_user_id ? String(row.owner_user_id) : null,
      responsableNombre: row.owner_name ? String(row.owner_name) : null,
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

/** Cuántas tarjetas se dibujan por columna. Más que esto no se lee. */
const POR_COLUMNA = 25

export type TarjetaContacto = {
  id: string
  displayName: string
  city: string | null
  phone: string | null
  /** De qué es la consulta, en una línea. */
  asunto: string | null
  etiquetas: { id: string; name: string; color: string }[]
  responsableId: string | null
  responsableNombre: string | null
  /** El turno más cercano que tiene por delante. */
  proximaAccion: { titulo: string; tipo: string | null; inicia: string } | null
  /** Alguna conversación suya está tomada por una persona (IA apagada). */
  atiendePersona: boolean
  /** La conversación más reciente, para el botón de WhatsApp. */
  conversationId: string | null
  /** Desde cuándo está en esta etapa: es el "Cerrado el:" de la tarjeta. */
  enLaEtapaDesde: string
}

export type PipelineColumn = Stage & {
  contacts: TarjetaContacto[]
  total: number
}

/**
 * El tablero del embudo, con todo lo que muestra cada tarjeta.
 *
 * Va en cinco consultas y no en una sola con seis `left join`: los joins
 * multiplican filas (un contacto con tres etiquetas y dos turnos son seis
 * filas del mismo contacto) y eso se paga en la base y se vuelve a pagar
 * armando el resultado. Acá se traen los contactos, se decide cuáles se
 * dibujan, y recién ahí se piden los datos de ESOS: como mucho 25 por
 * columna, aunque el embudo tenga mil.
 */
export async function getPipeline(
  ctx: TenantContext,
  opts: { archivados?: boolean; soloDe?: string } = {},
): Promise<PipelineColumn[]> {
  const stages = await getStages(ctx)
  const verArchivados = Boolean(opts.archivados)
  const soloDe = opts.soloDe && UUID_RE.test(opts.soloDe) ? opts.soloDe : null

  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select c.id, c.display_name, c.city, c.phone, c.stage_id, c.asunto,
             c.stage_since, c.owner_user_id, u.name as owner_name
        from contacts c
   left join users u on u.id = c.owner_user_id
       where ((${verArchivados} = true and c.archived_at is not null)
           or (${verArchivados} = false and c.archived_at is null))
         and (${soloDe}::uuid is null or c.owner_user_id = ${soloDe})
       order by c.last_activity_at desc nulls last limit 500
    `)
    const rows = res.rows as Record<string, unknown>[]

    // Qué contactos se dibujan de verdad. Todo lo que sigue es sobre estos.
    const porEtapa = new Map<string, Record<string, unknown>[]>()
    for (const s of stages) porEtapa.set(s.id, [])
    for (const r of rows) {
      const lista = porEtapa.get(String(r.stage_id))
      if (lista) lista.push(r)
    }
    const visibles = [...porEtapa.values()].flatMap((l) => l.slice(0, POR_COLUMNA))
    const ids = visibles.map((r) => String(r.id))

    if (ids.length === 0) {
      return stages.map((s) => ({ ...s, total: 0, contacts: [] }))
    }

    const enLista = sql`(${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`

    const [etiquetas, turnos, hilos] = await Promise.all([
      tx.execute(sql`
        select ct.contact_id, t.id, t.name, t.color
          from contact_tags ct
          join tags t on t.id = ct.tag_id
         where ct.contact_id in ${enLista}
         order by t.name
      `),
      // Uno por contacto: el más cercano que sigue en pie.
      tx.execute(sql`
        select distinct on (contact_id)
               contact_id, titulo, tipo, starts_at
          from appointments
         where contact_id in ${enLista}
           and status = 'programada' and ends_at >= now()
         order by contact_id, starts_at
      `),
      // La conversación más reciente para el botón, y si alguna está tomada
      // por una persona. Son dos preguntas distintas sobre la misma tabla.
      tx.execute(sql`
        select contact_id,
               (array_agg(id order by last_message_at desc nulls last))[1] as conv_id,
               bool_or(not ai_enabled) as atiende_persona
          from conversations
         where contact_id in ${enLista} and archived_at is null
         group by contact_id
      `),
    ])

    const porContacto = <T,>(filas: Record<string, unknown>[], f: (r: Record<string, unknown>) => T) => {
      const m = new Map<string, T[]>()
      for (const r of filas) {
        const k = String(r.contact_id)
        const l = m.get(k)
        if (l) l.push(f(r))
        else m.set(k, [f(r)])
      }
      return m
    }

    const tagsDe = porContacto(etiquetas.rows as Record<string, unknown>[], (r) => ({
      id: String(r.id),
      name: String(r.name),
      color: String(r.color),
    }))
    const turnoDe = new Map(
      (turnos.rows as Record<string, unknown>[]).map((r) => [
        String(r.contact_id),
        {
          titulo: String(r.titulo),
          tipo: r.tipo ? String(r.tipo) : null,
          inicia: String(r.starts_at),
        },
      ]),
    )
    const hiloDe = new Map(
      (hilos.rows as Record<string, unknown>[]).map((r) => [
        String(r.contact_id),
        {
          conversationId: r.conv_id ? String(r.conv_id) : null,
          atiendePersona: Boolean(r.atiende_persona),
        },
      ]),
    )

    return stages.map((s) => {
      const mios = porEtapa.get(s.id) ?? []
      return {
        ...s,
        total: mios.length,
        contacts: mios.slice(0, POR_COLUMNA).map((r) => {
          const id = String(r.id)
          const hilo = hiloDe.get(id)
          return {
            id,
            displayName: String(r.display_name),
            city: r.city ? String(r.city) : null,
            phone: r.phone ? String(r.phone) : null,
            asunto: r.asunto ? String(r.asunto) : null,
            etiquetas: tagsDe.get(id) ?? [],
            responsableId: r.owner_user_id ? String(r.owner_user_id) : null,
            responsableNombre: r.owner_name ? String(r.owner_name) : null,
            proximaAccion: turnoDe.get(id) ?? null,
            atiendePersona: hilo?.atiendePersona ?? false,
            conversationId: hilo?.conversationId ?? null,
            enLaEtapaDesde: String(r.stage_since),
          }
        }),
      }
    })
  })
}

// ---------------------------------------------------------------------
// El reporte que pidió el doctor: embudo y zonas
// ---------------------------------------------------------------------

export type FunnelReport = {
  stages: {
    name: string
    color: string
    /** Cuántos PASARON por acá alguna vez. Es la barra. */
    pasaron: number
    /** Cuántos están acá AHORA. Es el número que se ve en el tablero. */
    ahora: number
    isWon: boolean
    isLost: boolean
  }[]
  byCity: { city: string; total: number; operados: number }[]
  totals: { contactos: number; operados: number; conversion: number }
}

export async function getFunnelReport(
  ctx: TenantContext,
  /** Null = «Actual»: todos los contactos, sin recorte por fecha de alta. */
  days: number | null,
): Promise<FunnelReport> {
  // El corte se calcula acá y viaja como fecha, no como intervalo que la
  // consulta tenga que apagar cuando es nulo. «Actual» es simplemente una
  // fecha vieja: así hay UN solo camino en el SQL, sin `is null` repetido
  // cuatro veces ni un cast que se comporte distinto según el caso.
  const desde =
    days === null ? new Date(0) : new Date(Date.now() - days * 86400000)

  return withTenant(ctx, async (tx) => {
    /**
     * Dos números por etapa, y ninguno inventado.
     *
     * `pasaron` sale de que EXISTA una fila en `stage_history` para esa
     * etapa. Antes se calculaba como "la posición más alta que alcanzó >=
     * esta posición", y eso INVENTA: un contacto que va de «Nueva consulta»
     * derecho a «Interesado» nunca estuvo en «Contactado», pero esa cuenta
     * lo sumaba igual. El cliente abría el tablero, veía Contactado en 0, y
     * el reporte le decía 2. No era una forma distinta de mirar lo mismo:
     * era un número falso.
     *
     * `ahora` es la ocupación actual — exactamente el número del tablero.
     * Van los dos a la vista porque la pregunta que hizo el cliente
     * ("¿por qué no coinciden?") solo se contesta mostrando ambos: uno es
     * histórico y el otro es hoy, y por definición no tienen por qué dar
     * igual.
     *
     * Las etapas de descarte ya no son un caso aparte. Antes se contaban con
     * OTRA fórmula que el resto —ocupación actual mientras las demás iban
     * acumuladas—, así que el embudo podía terminar con una barra que subía.
     */
    const stageRes = await tx.execute(sql`
      select s.name, s.color, s.is_won, s.is_lost, s.position,
             (select count(distinct h.contact_id)
                from stage_history h
                join contacts c on c.id = h.contact_id
                                and c.tenant_id = h.tenant_id
               where h.to_stage_id = s.id
                 and h.tenant_id = ${ctx.tenantId}
                 and c.archived_at is null
                 and c.created_at > ${desde}) as pasaron,
             (select count(*)
                from contacts c2
               where c2.stage_id = s.id
                 and c2.tenant_id = ${ctx.tenantId}
                 and c2.archived_at is null
                 and c2.created_at > ${desde}) as ahora
        from stages s
       where s.tenant_id = ${ctx.tenantId}
       order by s.position
    `)

    /**
     * Los totales, contando CONTACTOS y no sumando etapas.
     *
     * `operados` antes sumaba el conteo de todas las etapas ganadoras, así
     * que con dos etapas marcadas como ganadoras el mismo contacto contaba
     * dos veces y la conversión pasaba del 100%.
     *
     * "Ganó" es haber LLEGADO alguna vez a una etapa ganadora, no estar ahí
     * hoy: alguien que cerró y después se movió a otra etapa igual convirtió.
     */
    const totRes = await tx.execute(sql`
      select count(*) as contactos,
             count(*) filter (
               where exists (
                 select 1 from stage_history h
                   join stages sg on sg.id = h.to_stage_id
                                 and sg.tenant_id = h.tenant_id
                  where h.contact_id = c.id
                    and h.tenant_id = ${ctx.tenantId}
                    and sg.is_won)) as ganados
        from contacts c
       where c.tenant_id = ${ctx.tenantId}
         and c.archived_at is null
         and c.created_at > ${desde}
    `)

    // "De qué zona son los que se operaron" — el pedido textual del doctor.
    // Mismo criterio de "ganó" que los totales: haber llegado, no estar hoy.
    const cityRes = await tx.execute(sql`
      select coalesce(nullif(c.city, ''), 'Sin zona') as city,
             count(*) as total,
             count(*) filter (
               where exists (
                 select 1 from stage_history h
                   join stages sg on sg.id = h.to_stage_id
                                 and sg.tenant_id = h.tenant_id
                  where h.contact_id = c.id
                    and h.tenant_id = ${ctx.tenantId}
                    and sg.is_won)) as operados
        from contacts c
       where c.tenant_id = ${ctx.tenantId}
         and c.archived_at is null
         and c.created_at > ${desde}
       group by 1 order by operados desc, total desc limit 20
    `)

    const stages = (stageRes.rows as Record<string, unknown>[]).map((r) => ({
      name: String(r.name),
      color: String(r.color),
      pasaron: Number(r.pasaron),
      ahora: Number(r.ahora),
      isWon: Boolean(r.is_won),
      isLost: Boolean(r.is_lost),
    }))

    const t = totRes.rows[0] as { contactos: string; ganados: string } | undefined
    const contactos = Number(t?.contactos ?? 0)
    const operados = Number(t?.ganados ?? 0)

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
  /** 'baileys' (QR) o 'cloud_api' (oficial). */
  provider: string
  /** Cloud API: últimos caracteres del token cargado, para reconocerlo. */
  tokenHint: string | null
}

export async function getWhatsAppAccounts(
  ctx: TenantContext,
): Promise<WhatsAppAccount[]> {
  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select id, label, status, phone, qr, last_error, connected_at,
             qr_expires_at, provider, token_hint
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
        provider: String(r.provider),
        tokenHint: r.token_hint ? String(r.token_hint) : null,
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
    /**
     * Id de usuario: devuelve solo los contactos a su cargo.
     *
     * Lo usa la pantalla de Contactos para un operador. NO es una regla de
     * acceso a los datos: si abre una conversación desde la bandeja, la
     * ficha de esa persona la sigue viendo. Es de quién es la pantalla, no
     * qué puede leer.
     */
    soloDe?: string
  } = {},
): Promise<PaginaContactos> {
  const porPagina = Math.min(100, Math.max(10, opts.porPagina ?? 25))
  const pagina = Math.max(1, opts.pagina ?? 1)
  const offset = (pagina - 1) * porPagina
  const buscar = opts.buscar?.trim() || null
  const etapa = opts.etapa?.trim() || null
  const archivados = Boolean(opts.archivados)
  const soloDe = opts.soloDe && UUID_RE.test(opts.soloDe) ? opts.soloDe : null

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
         and (${soloDe}::uuid is null or c.owner_user_id = ${soloDe})
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
