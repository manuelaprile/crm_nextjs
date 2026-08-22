/**
 * Procesamiento de un mensaje entrante.
 *
 * Vive separado de la ruta HTTP para que el simulador de `/pruebas` ejercite
 * EXACTAMENTE el mismo camino que un mensaje real de WhatsApp: mismo reclamo
 * de evento, misma resolución de contacto, misma idempotencia. Si el
 * simulador tuviera su propia copia de esta lógica, probaría la copia y no el
 * sistema.
 */
import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import { runAgentForConversation } from './agent'

export type InboundPayload = {
  eventId: string
  kind: string
  tenantId: string
  accountId: string
  accountJid: string | null
  message: WaMessage
}

export type WaMessage = {
  key: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null }
  pushName?: string | null
  messageTimestamp?: number | string | null
  message?: Record<string, unknown> | null
}

export type ResultadoIngesta =
  | { estado: 'duplicado' }
  | { estado: 'ignorado' }
  | { estado: 'ok'; conversationId: string }

/**
 * Reclama el evento, lo procesa y dispara el agente.
 *
 * El ORDEN importa: reclamar ANTES de procesar es lo que evita que dos
 * reintentos simultáneos le contesten dos veces al mismo paciente.
 */
export async function procesarEntrante(
  payload: InboundPayload,
): Promise<ResultadoIngesta> {
  const reclamado = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      insert into webhook_events (event_id, tenant_id, provider, kind, payload)
      values (${payload.eventId}, ${payload.tenantId}, 'baileys',
              ${payload.kind}, ${JSON.stringify(payload)}::jsonb)
      on conflict (event_id) do nothing
      returning event_id
    `)
    return res.rows.length > 0
  })

  if (!reclamado) return { estado: 'duplicado' }

  try {
    const result = await ingest(payload)

    await withSystem((tx) =>
      tx.execute(
        sql`update webhook_events set processed_at = now()
            where event_id = ${payload.eventId}`,
      ),
    )

    if (!result?.conversationId) return { estado: 'ignorado' }

    // El agente corre DESPUÉS de responder: no se await-ea.
    if (result.shouldRunAgent) {
      void runAgentForConversation(result.conversationId).catch((err) => {
        console.error('[agente] falló', err)
      })
    }

    return { estado: 'ok', conversationId: result.conversationId }
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

// ---------------------------------------------------------------------
// Procesamiento
// ---------------------------------------------------------------------

async function ingest(payload: InboundPayload) {
  const msg = payload.message
  const jid = msg.key.remoteJid
  if (!jid) return null

  const isGroup = jid.endsWith('@g.us')
  const text = extractText(msg)
  const type = messageType(msg)
  const externalId = msg.key.id ?? null
  const sentAt = timestampToDate(msg.messageTimestamp)

  return withSystem(async (tx) => {
    // ---- 3. Rutear por la cuenta -----------------------------------
    const accountRes = await tx.execute(sql`
      select ca.id, ca.tenant_id, ca.channel, ca.provider
        from channel_accounts ca
        join tenants t on t.id = ca.tenant_id
       where ca.id = ${payload.accountId}
         and t.status in ('trial','active')
    `)
    const account = accountRes.rows[0] as
      | { id: string; tenant_id: string; channel: string; provider: string }
      | undefined
    // Sin match no es un error: puede ser una cuenta borrada o un tenant
    // suspendido. Se ignora en silencio.
    if (!account) return null

    const tenantId = account.tenant_id
    const channel = account.channel
    const provider = account.provider

    // ---- 4a. Resolver el contacto por identidad --------------------
    // La identidad es (canal, external_id), NO el teléfono. Ver CLAUDE.md.
    let contactId: string | null = null
    if (!isGroup) {
      const identityRes = await tx.execute(sql`
        select contact_id from contact_identities
         where tenant_id = ${tenantId} and channel = ${channel}
           and external_id = ${jid}
      `)
      contactId = (identityRes.rows[0]?.contact_id as string) ?? null

      if (!contactId) {
        const stageRes = await tx.execute(sql`
          select id from stages where tenant_id = ${tenantId} and is_initial limit 1
        `)
        const stageId = (stageRes.rows[0]?.id as string) ?? null
        const phone = jid.split('@')[0]?.split(':')[0] ?? null
        const name = msg.pushName?.trim() || phone || 'Sin nombre'

        const contactRes = await tx.execute(sql`
          insert into contacts (tenant_id, display_name, phone, source, stage_id, last_activity_at)
          values (${tenantId}, ${name}, ${phone}, ${channel}, ${stageId}, now())
          returning id
        `)
        contactId = String(contactRes.rows[0]!.id)

        await tx.execute(sql`
          insert into contact_identities (tenant_id, contact_id, channel, external_id, handle)
          values (${tenantId}, ${contactId}, ${channel}, ${jid}, ${phone})
          on conflict (tenant_id, channel, external_id) do nothing
        `)

        if (stageId) {
          await tx.execute(sql`
            insert into stage_history (tenant_id, contact_id, to_stage_id, reason)
            values (${tenantId}, ${contactId}, ${stageId}, 'Primer contacto por ${sql.raw(channel)}')
          `)
        }
      } else {
        // Si estaba archivado y vuelve a escribir, reaparece. Archivar es
        // "sacarlo de la vista", no "ignorarlo para siempre": que una
        // consulta nueva quede escondida sería perder un paciente.
        await tx.execute(sql`
          update contacts
             set last_activity_at = now(), archived_at = null
           where id = ${contactId}
        `)
      }
    }

    // ---- 4b. Conversación ------------------------------------------
    // Única por (provider, external_id). Ver CLAUDE.md.
    const convRes = await tx.execute(sql`
      insert into conversations (
        tenant_id, channel, provider, account_id, external_id, contact_id,
        participant_name, participant_phone, is_group,
        last_message_at, last_inbound_at, unread_count
      ) values (
        ${tenantId}, ${channel}, ${provider}, ${account.id}, ${jid}, ${contactId},
        ${msg.pushName ?? null}, ${jid.split('@')[0]?.split(':')[0] ?? null}, ${isGroup},
        ${sentAt}, ${sentAt}, 1
      )
      on conflict (provider, external_id) do update set
        archived_at = null,
        last_message_at = excluded.last_message_at,
        last_inbound_at = excluded.last_inbound_at,
        unread_count = conversations.unread_count + 1,
        participant_name = coalesce(excluded.participant_name, conversations.participant_name),
        contact_id = coalesce(conversations.contact_id, excluded.contact_id)
      returning id, ai_enabled
    `)
    const conversation = convRes.rows[0] as { id: string; ai_enabled: boolean }

    // ---- 4c. Mensaje ------------------------------------------------
    // El índice único parcial sobre external_id hace la idempotencia real.
    await tx.execute(sql`
      insert into messages (
        tenant_id, conversation_id, channel, provider, external_id,
        direction, type, body, status, sender_kind, raw_payload, sent_at
      ) values (
        ${tenantId}, ${conversation.id}, ${channel}, ${provider}, ${externalId},
        'inbound', ${type}, ${text}, 'delivered', 'contact',
        ${JSON.stringify(msg)}::jsonb, ${sentAt}
      )
      -- El índice de idempotencia es PARCIAL (where external_id is not null).
      -- Postgres no puede inferirlo sin repetir el mismo predicado acá:
      -- sin el WHERE tira 42P10 (invalid column reference).
      on conflict (external_id) where external_id is not null do nothing
    `)

    // El agente solo corre en conversaciones individuales con IA activa.
    // El segundo interruptor (agent_configs.enabled) lo chequea el agente.
    return {
      conversationId: conversation.id,
      shouldRunAgent: !isGroup && conversation.ai_enabled && Boolean(text),
    }
  })
}

function extractText(msg: WaMessage): string | null {
  const m = msg.message
  if (!m) return null
  const candidates = [
    m.conversation,
    (m.extendedTextMessage as { text?: string } | undefined)?.text,
    (m.imageMessage as { caption?: string } | undefined)?.caption,
    (m.videoMessage as { caption?: string } | undefined)?.caption,
    (m.documentMessage as { caption?: string } | undefined)?.caption,
    (m.buttonsResponseMessage as { selectedDisplayText?: string } | undefined)
      ?.selectedDisplayText,
    (m.listResponseMessage as { title?: string } | undefined)?.title,
  ]
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c
  return null
}

function messageType(msg: WaMessage): string {
  const m = msg.message
  if (!m) return 'unknown'
  if (m.imageMessage) return 'image'
  if (m.videoMessage) return 'video'
  if (m.audioMessage) return 'audio'
  if (m.documentMessage) return 'document'
  if (m.locationMessage) return 'location'
  if (m.stickerMessage) return 'sticker'
  return 'text'
}

function timestampToDate(ts: number | string | null | undefined): Date {
  if (!ts) return new Date()
  const n = typeof ts === 'string' ? Number(ts) : ts
  if (!Number.isFinite(n)) return new Date()
  // WhatsApp manda segundos, no milisegundos.
  return new Date(n * 1000)
}
