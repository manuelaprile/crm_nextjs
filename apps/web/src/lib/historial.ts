/**
 * Importación del historial que WhatsApp replica al vincular un número.
 *
 * Vive aparte de `ingest.ts` a propósito. Un mensaje entrante y un mensaje
 * histórico se parecen mucho —misma forma, misma tabla— y esa es justamente la
 * trampa: si compartieran camino, alcanzaría un `if` mal puesto para que el
 * agente le conteste de golpe a dos años de conversaciones. Es la regla de
 * CLAUDE.md que más caro sale romper, así que acá directamente no existe la
 * llamada al agente.
 *
 * Las otras dos diferencias:
 *   - No suma no leídos. El historial no es trabajo pendiente.
 *   - No pisa el estado de las conversaciones que ya existen: solo estira
 *     `last_message_at` hacia atrás si hace falta.
 */
import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import {
  extractText,
  identidadDe,
  messageType,
  timestampToDate,
  type WaMessage,
} from './ingest'

export type HistorialPayload = {
  eventId: string
  kind: 'history.messages' | 'history.contacts'
  tenantId: string
  accountId: string
  accountJid: string | null
  messages?: WaMessage[]
  contacts?: ContactoAgenda[]
}

export type ContactoAgenda = {
  /** El JID tal como lo identifica WhatsApp: puede ser @lid o @s.whatsapp.net. */
  jid: string
  lid?: string | null
  pn?: string | null
  name?: string | null
}

type Cuenta = {
  id: string
  tenant_id: string
  channel: string
  provider: string
}

export type ResultadoHistorial = {
  estado: 'duplicado' | 'ignorado' | 'ok'
  conversaciones?: number
  mensajes?: number
  contactos?: number
}

/**
 * Reclama el lote y lo importa.
 *
 * El reclamo es el mismo de `webhook_events` que usa la ingesta normal: el
 * historial llega en tandas y una tanda reenviada no puede duplicar nada. La
 * segunda red es el índice único parcial sobre `messages.external_id`, que es
 * lo que de verdad garantiza que un mensaje entre una sola vez aunque el lote
 * venga partido distinto.
 */
export async function procesarHistorial(
  payload: HistorialPayload,
): Promise<ResultadoHistorial> {
  const reclamado = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      insert into webhook_events (event_id, tenant_id, provider, kind, payload)
      values (${payload.eventId}, ${payload.tenantId}, 'baileys',
              ${payload.kind}, ${JSON.stringify({
                eventId: payload.eventId,
                kind: payload.kind,
                accountId: payload.accountId,
                n: payload.messages?.length ?? payload.contacts?.length ?? 0,
              })}::jsonb)
      on conflict (event_id) do nothing
      returning event_id
    `)
    return res.rows.length > 0
  })

  if (!reclamado) return { estado: 'duplicado' }

  try {
    const cuenta = await buscarCuenta(payload.accountId)
    if (!cuenta) return { estado: 'ignorado' }

    const resultado =
      payload.kind === 'history.contacts'
        ? await importarAgenda(cuenta, payload.contacts ?? [])
        : await importarMensajes(cuenta, payload.messages ?? [])

    await withSystem((tx) =>
      tx.execute(
        sql`update webhook_events set processed_at = now()
            where event_id = ${payload.eventId}`,
      ),
    )
    return { estado: 'ok', ...resultado }
  } catch (err) {
    await withSystem((tx) =>
      tx.execute(
        sql`update webhook_events set error = ${String(err)}
            where event_id = ${payload.eventId}`,
      ),
    )
    throw err
  }
}

async function buscarCuenta(accountId: string): Promise<Cuenta | undefined> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select ca.id, ca.tenant_id, ca.channel, ca.provider
        from channel_accounts ca
        join tenants t on t.id = ca.tenant_id
       where ca.id = ${accountId}
         and t.status in ('trial','active')
    `)
    return res.rows[0] as Cuenta | undefined
  })
}

// ---------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------

/**
 * Los nombres que el cliente tiene guardados en la agenda del teléfono.
 *
 * Llegan antes que los mensajes, y son lo que hace que la bandeja se vea como
 * el WhatsApp del cliente y no como una lista de números. Solo completa: un
 * nombre escrito a mano en el CRM nunca se pisa, porque suele ser mejor que el
 * de la agenda ("Juan Pérez – rodilla" vs "Juan").
 */
async function importarAgenda(
  cuenta: Cuenta,
  contactos: ContactoAgenda[],
): Promise<{ contactos: number }> {
  if (!contactos.length) return { contactos: 0 }

  let tocados = 0
  await withSystem(async (tx) => {
    for (const c of contactos) {
      const nombre = c.name?.trim()
      if (!c.jid || !nombre) continue
      const phone = c.pn ? (c.pn.split('@')[0]?.split(':')[0] ?? null) : null

      // Cuál nombre gana.
      //
      // Hay tres: el que la persona se puso en su propio WhatsApp (`pushName`,
      // que queda en `conversations.participant_name`), el que el cliente tiene
      // guardado en la agenda del teléfono, y el que alguien escribió a mano en
      // el CRM. La agenda le gana al pushName —es lo que hace el WhatsApp del
      // cliente y es lo que espera ver— pero no le gana a lo escrito a mano,
      // que suele ser mejor: "Juan Pérez – rodilla" contra "Juan".
      //
      // La forma de distinguirlos es que el nombre escrito a mano dejó de
      // coincidir con el pushName guardado en la conversación.
      const res = await tx.execute(sql`
        update contacts c
           set display_name = ${nombre},
               phone = coalesce(c.phone, ${phone})
          from contact_identities i
          left join conversations v
            on v.tenant_id = i.tenant_id
           and v.provider = ${cuenta.provider}
           and v.external_id = i.external_id
         where i.contact_id = c.id
           and i.tenant_id = ${cuenta.tenant_id}
           and i.channel = ${cuenta.channel}
           and i.external_id = ${c.jid}
           and c.tenant_id = ${cuenta.tenant_id}
           and c.display_name is distinct from ${nombre}
           and (c.display_name is null
                or c.display_name = 'Sin nombre'
                or c.display_name = coalesce(c.phone, '~')
                or c.display_name = split_part(i.external_id, '@', 1)
                or c.display_name = v.participant_name)
        returning c.id
      `)
      tocados += res.rows.length

      await tx.execute(sql`
        update conversations
           set participant_name = ${nombre},
               participant_phone = coalesce(participant_phone, ${phone})
         where tenant_id = ${cuenta.tenant_id}
           and provider = ${cuenta.provider}
           and external_id = ${c.jid}
           and participant_name is distinct from ${nombre}
      `)
    }
  })

  return { contactos: tocados }
}

// ---------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------

async function importarMensajes(
  cuenta: Cuenta,
  mensajes: WaMessage[],
): Promise<{ conversaciones: number; mensajes: number }> {
  // Agrupados por chat: resolver contacto y conversación una vez por hilo en
  // vez de una vez por mensaje. Una tanda de 200 mensajes suele ser un puñado
  // de conversaciones.
  const porChat = new Map<string, WaMessage[]>()
  for (const m of mensajes) {
    const jid = m.key.remoteJid
    if (!jid || !m.key.id) continue
    const lista = porChat.get(jid)
    if (lista) lista.push(m)
    else porChat.set(jid, [m])
  }

  let guardados = 0
  for (const [jid, delChat] of porChat) {
    guardados += await importarChat(cuenta, jid, delChat)
  }
  return { conversaciones: porChat.size, mensajes: guardados }
}

async function importarChat(
  cuenta: Cuenta,
  jid: string,
  mensajes: WaMessage[],
): Promise<number> {
  const isGroup = jid.endsWith('@g.us')
  const { tenant_id: tenantId, channel, provider } = cuenta

  // El más nuevo del lote, para la fecha de la conversación. El historial
  // llega desordenado y en tandas: no se puede asumir que el último del array
  // es el último en el tiempo.
  const fechas = mensajes.map((m) => timestampToDate(m.messageTimestamp))
  const ultimo = new Date(Math.max(...fechas.map((d) => d.getTime())))
  const entrantes = mensajes.filter((m) => !m.key.fromMe)
  const ultimoEntrante = entrantes.length
    ? new Date(
        Math.max(
          ...entrantes.map((m) => timestampToDate(m.messageTimestamp).getTime()),
        ),
      )
    : null

  // El nombre y el teléfono salen de un mensaje entrante: en los propios,
  // `pushName` es el del dueño de la línea, no el del contacto.
  const muestra = entrantes[0] ?? mensajes[0]!
  const { phone } = identidadDe(muestra)
  const pushName = entrantes[0]?.pushName?.trim() || null

  return withSystem(async (tx) => {
    // ---- Contacto ---------------------------------------------------
    let contactId: string | null = null
    if (!isGroup) {
      const ident = await tx.execute(sql`
        select contact_id from contact_identities
         where tenant_id = ${tenantId} and channel = ${channel}
           and external_id = ${jid}
      `)
      contactId = (ident.rows[0]?.contact_id as string) ?? null

      if (!contactId) {
        const stageRes = await tx.execute(sql`
          select id from stages where tenant_id = ${tenantId} and is_initial limit 1
        `)
        const stageId = (stageRes.rows[0]?.id as string) ?? null
        const nombre = pushName || phone || 'Sin nombre'

        const nuevo = await tx.execute(sql`
          insert into contacts (tenant_id, display_name, phone, source, stage_id, last_activity_at)
          values (${tenantId}, ${nombre}, ${phone}, ${channel}, ${stageId}, ${ultimo})
          returning id
        `)
        contactId = String(nuevo.rows[0]!.id)

        await tx.execute(sql`
          insert into contact_identities (tenant_id, contact_id, channel, external_id, handle)
          values (${tenantId}, ${contactId}, ${channel}, ${jid}, ${phone})
          on conflict (tenant_id, channel, external_id) do nothing
        `)

        if (stageId) {
          await tx.execute(sql`
            insert into stage_history (tenant_id, contact_id, to_stage_id, reason)
            values (${tenantId}, ${contactId}, ${stageId},
                    'Importado del historial de WhatsApp')
          `)
        }
      } else {
        await tx.execute(sql`
          update contacts
             set last_activity_at = greatest(coalesce(last_activity_at, ${ultimo}), ${ultimo}),
                 phone = coalesce(phone, ${phone})
           where id = ${contactId}
        `)
      }
    }

    // ---- Conversación -----------------------------------------------
    // Sin tocar `unread_count`: importar historial no genera trabajo nuevo.
    // `greatest` porque las tandas llegan desordenadas y una vieja no puede
    // hacer retroceder la fecha de una conversación que ya está al día.
    const conv = await tx.execute(sql`
      insert into conversations (
        tenant_id, channel, provider, account_id, external_id, contact_id,
        participant_name, participant_phone, is_group,
        last_message_at, last_inbound_at, unread_count
      ) values (
        ${tenantId}, ${channel}, ${provider}, ${cuenta.id}, ${jid}, ${contactId},
        ${pushName}, ${phone}, ${isGroup},
        ${ultimo}, ${ultimoEntrante}, 0
      )
      on conflict (provider, external_id) do update set
        last_message_at = greatest(
          coalesce(conversations.last_message_at, excluded.last_message_at),
          excluded.last_message_at),
        last_inbound_at = greatest(conversations.last_inbound_at, excluded.last_inbound_at),
        participant_name = coalesce(conversations.participant_name, excluded.participant_name),
        participant_phone = coalesce(conversations.participant_phone, excluded.participant_phone),
        contact_id = coalesce(conversations.contact_id, excluded.contact_id)
      returning id
    `)
    const conversationId = String((conv.rows[0] as { id: string }).id)

    // ---- Mensajes ----------------------------------------------------
    let n = 0
    for (const m of mensajes) {
      const body = extractText(m)
      const propio = Boolean(m.key.fromMe)
      const res = await tx.execute(sql`
        insert into messages (
          tenant_id, conversation_id, channel, provider, external_id,
          direction, type, body, status, sender_kind, raw_payload, sent_at
        ) values (
          ${tenantId}, ${conversationId}, ${channel}, ${provider}, ${m.key.id},
          ${propio ? 'outbound' : 'inbound'}, ${messageType(m)}, ${body},
          ${propio ? 'sent' : 'delivered'},
          ${propio ? 'operator' : 'contact'},
          ${JSON.stringify(m)}::jsonb, ${timestampToDate(m.messageTimestamp)}
        )
        on conflict (external_id) where external_id is not null do nothing
        returning id
      `)
      n += res.rows.length
    }
    return n
  })
}
