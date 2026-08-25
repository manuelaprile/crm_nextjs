'use server'

/**
 * Server Actions del panel.
 *
 * Toda acción empieza por `requireTenant()` / `requireAdmin()`: el tenant sale
 * de la SESIÓN, nunca de un campo del formulario. Un `<input name="tenantId">`
 * escondido sería exactamente el agujero que RLS está para tapar.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { requireAdmin, requireTenant, logout as endSession } from './auth'
import { cupoDeWhatsApp } from './cupo'
import { withTenant } from './db/client'
import { deliverMessage } from './deliver'

const WORKER_URL = process.env.WORKER_URL ?? 'http://wa-worker:4000'
const WORKER_SECRET = process.env.WORKER_SECRET ?? ''

type WorkerResult = { ok: true } | { ok: false; error: string }

async function callWorker(path: string, body: unknown): Promise<WorkerResult> {
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return { ok: true }
    if (res.status === 401) {
      return { ok: false, error: 'WORKER_SECRET no coincide entre la app y el worker.' }
    }
    return { ok: false, error: `El worker respondió ${res.status}.` }
  } catch (err) {
    // El caso más común y el más confuso: el worker no está levantado. Antes
    // esto fallaba en silencio y el botón "no hacía nada".
    const detail = String(err).includes('ECONNREFUSED')
      ? 'El servicio de WhatsApp no está corriendo.'
      : String(err).includes('timeout') || String(err).includes('TimeoutError')
        ? 'El servicio de WhatsApp no respondió a tiempo.'
        : 'No se pudo contactar al servicio de WhatsApp.'
    return { ok: false, error: detail }
  }
}

/** Deja el motivo visible en la pantalla de WhatsApp en vez de fallar callado. */
async function recordAccountError(
  session: { tenantId: string; userId: string; role: 'owner' | 'admin' | 'agent' },
  accountId: string,
  error: string,
): Promise<void> {
  await withTenant(session, (tx) =>
    tx.execute(sql`
      update channel_accounts
         set last_error = ${error}, status = 'disconnected'
       where id = ${accountId}
    `),
  )
}

// ---------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------

export async function sendReply(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const conversationId = String(formData.get('conversationId') ?? '')
  const text = String(formData.get('text') ?? '')
  if (!conversationId || !text.trim()) return

  // Verificar que la conversación es de ESTE consultorio antes de mandar nada.
  // deliverMessage corre sin contexto de tenant (lo necesita para el worker),
  // así que la autorización se hace acá.
  const allowed = await withTenant(session, async (tx) => {
    const res = await tx.execute(
      sql`select 1 from conversations where id = ${conversationId}`,
    )
    return res.rows.length > 0
  })
  if (!allowed) return

  // Responder a mano apaga la IA de esa conversación: si la secretaria entró a
  // contestar, no queremos que el bot le hable por encima.
  await withTenant(session, (tx) =>
    tx.execute(
      sql`update conversations set ai_enabled = false where id = ${conversationId}`,
    ),
  )

  await deliverMessage({
    conversationId,
    text,
    senderKind: 'operator',
    senderUserId: session.userId,
  })

  revalidatePath(`/bandeja/${conversationId}`)
}

export async function toggleAi(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const conversationId = String(formData.get('conversationId') ?? '')
  if (!conversationId) return

  await withTenant(session, (tx) =>
    tx.execute(sql`
      update conversations set ai_enabled = not ai_enabled
       where id = ${conversationId}
    `),
  )
  revalidatePath(`/bandeja/${conversationId}`)
}

// ---------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------

export async function setStage(formData: FormData): Promise<void> {
  const contactId = String(formData.get('contactId') ?? '')
  const stageId = String(formData.get('stageId') ?? '')
  await moveContact(contactId, stageId)
  revalidatePath('/contactos')
  revalidatePath(`/contactos/${contactId}`)
}

/**
 * Mover un contacto de etapa. La usa el tablero de arrastrar y soltar.
 *
 * Devuelve un resultado en vez de tirar excepción: el tablero necesita poder
 * revertir la tarjeta a su columna original si el movimiento falló, y una
 * excepción en una Server Action llega al cliente como un error opaco.
 */
export async function moveContact(
  contactId: string,
  stageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireTenant()
  if (!contactId || !stageId) return { ok: false, error: 'faltan datos' }

  const done = await withTenant(session, async (tx) => {
    // La etapa tiene que ser de este consultorio. RLS ya lo garantiza, pero
    // el chequeo explícito hace que un id ajeno no cambie nada en silencio.
    const stage = await tx.execute(sql`select id from stages where id = ${stageId}`)
    if (!stage.rows.length) return false

    const prev = await tx.execute(
      sql`select stage_id from contacts where id = ${contactId}`,
    )
    if (!prev.rows.length) return false
    const fromStage = prev.rows[0]!.stage_id as string | null
    // Soltar la tarjeta en la misma columna no genera historial: si no, un
    // arrastre accidental ensucia el reporte de embudo.
    if (fromStage === stageId) return true

    await tx.execute(sql`
      update contacts set stage_id = ${stageId}, stage_since = now()
       where id = ${contactId}
    `)
    await tx.execute(sql`
      insert into stage_history
        (tenant_id, contact_id, from_stage_id, to_stage_id, changed_by)
      values (${session.tenantId}, ${contactId}, ${fromStage}, ${stageId},
              ${session.userId})
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
      values (${session.tenantId}, ${session.userId}, 'contact.stage_changed',
              'contact', ${contactId},
              ${JSON.stringify({ from: fromStage, to: stageId })}::jsonb)
    `)
    return true
  })

  if (!done) return { ok: false, error: 'no se encontró el contacto o la etapa' }

  revalidatePath('/contactos')
  revalidatePath(`/contactos/${contactId}`)
  return { ok: true }
}

export async function addNote(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const contactId = String(formData.get('contactId') ?? '')
  const body = String(formData.get('body') ?? '').trim().slice(0, 4000)
  if (!contactId || !body) return

  await withTenant(session, (tx) =>
    tx.execute(sql`
      insert into notes (tenant_id, contact_id, author_user_id, body)
      values (${session.tenantId}, ${contactId}, ${session.userId}, ${body})
    `),
  )
  revalidatePath(`/contactos/${contactId}`)
}

export async function updateContact(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const contactId = String(formData.get('contactId') ?? '')
  if (!contactId) return

  const name = String(formData.get('displayName') ?? '').trim().slice(0, 200)
  const city = String(formData.get('city') ?? '').trim().slice(0, 120)
  const province = String(formData.get('province') ?? '').trim().slice(0, 120)

  await withTenant(session, (tx) =>
    tx.execute(sql`
      update contacts set
        display_name = coalesce(nullif(${name}, ''), display_name),
        city         = nullif(${city}, ''),
        province     = nullif(${province}, '')
       where id = ${contactId}
    `),
  )
  revalidatePath(`/contactos/${contactId}`)
}

export async function toggleTag(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const contactId = String(formData.get('contactId') ?? '')
  const tagId = String(formData.get('tagId') ?? '')
  if (!contactId || !tagId) return

  await withTenant(session, async (tx) => {
    const existing = await tx.execute(sql`
      select 1 from contact_tags
       where contact_id = ${contactId} and tag_id = ${tagId}
    `)
    if (existing.rows.length) {
      await tx.execute(sql`
        delete from contact_tags
         where contact_id = ${contactId} and tag_id = ${tagId}
      `)
    } else {
      await tx.execute(sql`
        insert into contact_tags (tenant_id, contact_id, tag_id)
        values (${session.tenantId}, ${contactId}, ${tagId})
        on conflict do nothing
      `)
    }
  })
  revalidatePath(`/contactos/${contactId}`)
}

// ---------------------------------------------------------------------
// Archivar y eliminar contactos
// ---------------------------------------------------------------------

/**
 * Archivar es reversible y conserva todo: el contacto sale del embudo y de la
 * bandeja, pero el historial queda. Es lo que se usa en el día a día para
 * sacar de la vista a alguien que no va a avanzar.
 *
 * Si esa persona vuelve a escribir, la conversación reaparece y el contacto
 * se desarchiva solo — ver la ingesta.
 */
export async function archivarContacto(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const contactId = String(formData.get('contactId') ?? '')
  if (!contactId) return

  await withTenant(session, async (tx) => {
    await tx.execute(sql`
      update contacts set archived_at = now() where id = ${contactId}
    `)
    await tx.execute(sql`
      update conversations set archived_at = now() where contact_id = ${contactId}
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId}, 'contact.archived',
              'contact', ${contactId})
    `)
  })

  revalidatePath('/contactos')
  revalidatePath('/bandeja')
  redirect('/contactos')
}

export async function desarchivarContacto(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const contactId = String(formData.get('contactId') ?? '')
  if (!contactId) return

  await withTenant(session, async (tx) => {
    await tx.execute(sql`
      update contacts set archived_at = null where id = ${contactId}
    `)
    await tx.execute(sql`
      update conversations set archived_at = null where contact_id = ${contactId}
    `)
  })

  revalidatePath('/contactos')
  revalidatePath(`/contactos/${contactId}`)
  revalidatePath('/bandeja')
}

/**
 * Eliminar es DEFINITIVO y no se puede deshacer.
 *
 * Borra el contacto, sus identidades, notas, etiquetas, historial de etapas
 * **y sus conversaciones con todos los mensajes**. Lo último es a propósito:
 * si quedara la conversación, la clave única (provider, external_id) haría
 * que el mismo número volviera a caer en el hilo viejo. Sin eso no se puede
 * repetir una prueba con el mismo teléfono.
 *
 * Solo owner/admin: no es una operación para la secretaria.
 */
export async function eliminarContacto(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const contactId = String(formData.get('contactId') ?? '')
  if (!contactId) return

  await withTenant(session, async (tx) => {
    const datos = await tx.execute(sql`
      select display_name, phone from contacts where id = ${contactId}
    `)
    if (!datos.rows.length) return

    // El registro de auditoría va ANTES del borrado: después el contacto ya
    // no existe y no se podría saber a quién se eliminó.
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
      values (${session.tenantId}, ${session.userId}, 'contact.deleted',
              'contact', ${contactId}, ${JSON.stringify(datos.rows[0])}::jsonb)
    `)

    // Las conversaciones cuelgan del contacto con ON DELETE SET NULL, así que
    // no se van solas: hay que borrarlas explícitamente. Los mensajes sí
    // caen en cascada al borrar la conversación.
    await tx.execute(sql`
      delete from conversations where contact_id = ${contactId}
    `)
    // El resto (identidades, notas, etiquetas, historial) sí es en cascada.
    await tx.execute(sql`delete from contacts where id = ${contactId}`)
  })

  revalidatePath('/contactos')
  revalidatePath('/bandeja')
  redirect('/contactos')
}

// ---------------------------------------------------------------------
// WhatsApp — solo owner/admin. La secretaria no desconecta el número.
// ---------------------------------------------------------------------

export async function connectWhatsApp(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  let accountId = String(formData.get('accountId') ?? '')

  if (!accountId) {
    accountId = await withTenant(session, async (tx) => {
      const cupo = await cupoDeWhatsApp(tx, session.tenantId)
      if (!cupo.hayLugar) {
        throw new Error('Alcanzaste el límite de números de tu plan')
      }
      const res = await tx.execute(sql`
        insert into channel_accounts (tenant_id, label)
        values (${session.tenantId}, 'Principal') returning id
      `)
      return String(res.rows[0]!.id)
    })
  }

  const result = await callWorker('/sessions/connect', {
    accountId,
    tenantId: session.tenantId,
  })
  if (!result.ok) {
    await recordAccountError(session, accountId, result.error)
  } else {
    // Limpiar un error anterior y dejar el estado en "conectando": el worker
    // lo pisa apenas genera el QR.
    await withTenant(session, (tx) =>
      tx.execute(sql`
        update channel_accounts set last_error = null, status = 'connecting'
         where id = ${accountId}
      `),
    )
  }
  revalidatePath('/configuracion/whatsapp')
}

export async function disconnectWhatsApp(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const accountId = String(formData.get('accountId') ?? '')
  if (!accountId) return

  const owned = await withTenant(session, async (tx) => {
    const res = await tx.execute(
      sql`select 1 from channel_accounts where id = ${accountId}`,
    )
    return res.rows.length > 0
  })
  if (!owned) return

  const result = await callWorker('/sessions/logout', { accountId })
  if (!result.ok) await recordAccountError(session, accountId, result.error)
  revalidatePath('/configuracion/whatsapp')
}

// ---------------------------------------------------------------------

export async function signOut(): Promise<void> {
  await endSession()
  redirect('/login')
}
