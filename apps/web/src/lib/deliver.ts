/**
 * UN SOLO CAMINO DE SALIDA.
 *
 * Todo mensaje que sale del sistema pasa por acá: la bandeja, el agente de IA,
 * y cualquier automatización futura. La función **envía Y persiste**, en ese
 * orden y en un solo lugar.
 *
 * Por qué importa: si la interfaz inserta la fila por un lado y el agente la
 * inserta por otro, tarde o temprano se desincronizan y aparecen mensajes que
 * el cliente recibió pero que no figuran en el historial (o al revés). Es de
 * los bugs más difíciles de explicarle a un cliente.
 *
 * El flujo es: fila en `messages` con estado `pending` -> encolar en el worker
 * -> el worker actualiza a `sent` y le pone el external_id cuando WhatsApp se
 * lo confirma. Si el worker no está conectado, la fila queda en `failed` y se
 * ve en la bandeja: nunca desaparece en silencio.
 */
import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'

const WORKER_URL = process.env.WORKER_URL ?? 'http://wa-worker:4000'
const WORKER_SECRET = process.env.WORKER_SECRET ?? ''

export type DeliverInput = {
  conversationId: string
  text: string
  senderKind: 'ai' | 'operator' | 'system'
  senderUserId?: string | null
}

export type DeliverResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; messageId?: string }

export async function deliverMessage(
  input: DeliverInput,
): Promise<DeliverResult> {
  const text = input.text.trim()
  if (!text) return { ok: false, error: 'mensaje vacío' }
  // WhatsApp corta cerca de los 65k, pero un mensaje de 4000 caracteres ya es
  // ilegible en un celular. Cortamos antes por producto, no por límite técnico.
  if (text.length > 4000) return { ok: false, error: 'mensaje demasiado largo' }

  const ctx = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select c.id, c.tenant_id, c.channel, c.provider, c.external_id,
             c.account_id, ca.status as account_status
        from conversations c
        join channel_accounts ca on ca.id = c.account_id
       where c.id = ${input.conversationId}
    `)
    return res.rows[0] as
      | {
          id: string
          tenant_id: string
          channel: string
          provider: string
          external_id: string
          account_id: string
          account_status: string
        }
      | undefined
  })

  if (!ctx) return { ok: false, error: 'la conversación no existe' }

  // Primero la fila, después el envío. Si se cae el proceso justo en el medio,
  // queda una fila `pending` visible — que es infinitamente mejor que un
  // mensaje entregado del que no queda rastro.
  const messageId = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      insert into messages (
        tenant_id, conversation_id, channel, provider,
        direction, type, body, status, sender_kind, sender_user_id
      ) values (
        ${ctx.tenant_id}, ${ctx.id}, ${ctx.channel}, ${ctx.provider},
        'outbound', 'text', ${text}, 'pending', ${input.senderKind},
        ${input.senderUserId ?? null}
      ) returning id
    `)
    return String(res.rows[0]!.id)
  })

  // ---- Número simulado ----------------------------------------------
  // Con provider 'mock' el mensaje NO sale a WhatsApp: se marca como enviado
  // y queda en el historial. Sirve para probar el circuito completo (agente
  // incluido) sin un celular vinculado. Ver docs/MODO-PRUEBA.md.
  if (ctx.provider === 'mock') {
    await withSystem((tx) =>
      tx.execute(sql`
        update messages
           set status = 'sent', sent_at = now(), external_id = ${'mock-' + messageId}
         where id = ${messageId}
      `),
    )
    await withSystem((tx) =>
      tx.execute(sql`
        update conversations set last_message_at = now(), unread_count = 0
         where id = ${ctx.id}
      `),
    )
    return { ok: true, messageId }
  }

  if (ctx.account_status !== 'connected') {
    await markFailed(messageId, 'WhatsApp no está conectado')
    return { ok: false, error: 'WhatsApp no está conectado', messageId }
  }

  try {
    const res = await fetch(`${WORKER_URL}/messages/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({
        accountId: ctx.account_id,
        to: ctx.external_id,
        text,
        messageId,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const detail = res.status === 409 ? 'la sesión no está conectada' : `error ${res.status}`
      await markFailed(messageId, detail)
      return { ok: false, error: detail, messageId }
    }
  } catch (err) {
    await markFailed(messageId, String(err))
    return { ok: false, error: 'no se pudo contactar al worker', messageId }
  }

  await withSystem((tx) =>
    tx.execute(sql`
      update conversations set last_message_at = now(), unread_count = 0
       where id = ${ctx.id}
    `),
  )

  return { ok: true, messageId }
}

async function markFailed(messageId: string, error: string): Promise<void> {
  await withSystem((tx) =>
    tx.execute(sql`
      update messages set status = 'failed', error = ${error}
       where id = ${messageId}
    `),
  )
}
