'use server'

/**
 * Acciones de la tarjeta del contacto: quién lo sigue y el alta a mano.
 *
 * Lo demás del contacto —etapa, etiquetas, notas, archivar— ya vive en
 * `actions.ts` y no se mueve de ahí.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin, requireTenant } from './auth'
import { withTenant } from './db/client'
import { funcionActiva } from './funciones'

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(`/contactos?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`)
}

/**
 * Poner (o sacar) el responsable de un contacto.
 *
 * Y de paso, el de sus conversaciones SIN asignar. Esa es la decisión que se
 * tomó al diseñarlo: "a quién le toca" es una sola idea en las dos pantallas,
 * y quien asigna un contacto desde el tablero espera que el chat le aparezca
 * al mismo. Las conversaciones que YA tenían dueño no se tocan: eso fue una
 * decisión de alguien y no la pisa un efecto secundario.
 *
 * Solo owner/admin, igual que derivar una conversación. Si un operador
 * pudiera asignar contactos, estaría asignando conversaciones por la
 * ventana.
 */
export async function asignarContacto(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const contactId = String(formData.get('contactId') ?? '').trim()
  const userId = String(formData.get('userId') ?? '').trim() || null
  if (!contactId) return

  const error = await withTenant(session, async (tx) => {
    const existe = await tx.execute(
      sql`select owner_user_id from contacts where id = ${contactId}`,
    )
    if (!existe.rows.length) return 'Ese contacto no existe.'
    const antes = existe.rows[0]!.owner_user_id
      ? String(existe.rows[0]!.owner_user_id)
      : null

    if (userId) {
      const miembro = await tx.execute(sql`
        select 1 from tenant_users tu
          join users u on u.id = tu.user_id
         where tu.user_id = ${userId}
           and u.is_superadmin = false and u.disabled_at is null
      `)
      if (!miembro.rows.length) return 'Ese usuario no puede recibir contactos.'
    }

    if (antes === userId) return null

    await tx.execute(sql`
      update contacts set owner_user_id = ${userId} where id = ${contactId}
    `)

    // Las conversaciones sin dueño siguen al contacto. Cada una deja su
    // fila en el historial: que el cambio haya venido de rebote no lo hace
    // menos real para quien después pregunta quién la tenía.
    const arrastradas = await tx.execute(sql`
      update conversations set assigned_user_id = ${userId}
       where contact_id = ${contactId} and assigned_user_id is null
         and archived_at is null
       returning id
    `)
    for (const fila of arrastradas.rows as { id: string }[]) {
      await tx.execute(sql`
        insert into conversation_assignments
          (tenant_id, conversation_id, from_user_id, to_user_id, changed_by)
        values (${session.tenantId}, ${String(fila.id)}, null, ${userId},
                ${session.userId})
      `)
    }

    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
      values (${session.tenantId}, ${session.userId}, 'contact.assigned',
              'contact', ${contactId},
              ${JSON.stringify({ de: antes, a: userId })}::jsonb)
    `)
    return null
  })

  if (error) volver('error', error)

  // Sin redirigir: la URL del tablero lleva la vista y los filtros, y
  // reescribirla para mostrar un cartel te devuelve a otra pantalla.
  revalidatePath('/contactos')
  revalidatePath(`/contactos/${contactId}`)
  revalidatePath('/bandeja')
}

/**
 * Alta de un contacto a mano.
 *
 * Detrás del interruptor `alta-manual-contactos`, apagado por defecto. El
 * chequeo va acá y no solo en la pantalla: un interruptor que solo esconde
 * un botón no apaga nada.
 *
 * Un contacto cargado así NO tiene conversación: nadie escribió todavía. El
 * botón de WhatsApp de su tarjeta queda apagado hasta que exista un hilo, y
 * eso es correcto — la regla de Baileys es no escribirle a quien nunca
 * escribió.
 */
export async function crearContacto(formData: FormData): Promise<void> {
  const session = await requireTenant()
  if (!(await funcionActiva('alta-manual-contactos', session.tenantId))) {
    volver('error', 'El alta manual de contactos no está habilitada.')
  }

  const nombre = String(formData.get('displayName') ?? '').trim().slice(0, 200)
  const stageId = String(formData.get('stageId') ?? '').trim()
  const asunto = String(formData.get('asunto') ?? '').trim().slice(0, 200)
  const city = String(formData.get('city') ?? '').trim().slice(0, 120)
  // Solo dígitos: el teléfono se guarda como lo guarda la ingesta, sin + ni
  // espacios, o después no coincide con el de WhatsApp y queda duplicado.
  const phone = String(formData.get('phone') ?? '').replace(/\D/g, '').slice(0, 20)

  if (!nombre) volver('error', 'Falta el nombre.')
  if (!stageId) volver('error', 'Falta la etapa.')

  await withTenant(session, async (tx) => {
    const etapa = await tx.execute(sql`select id from stages where id = ${stageId}`)
    if (!etapa.rows.length) volver('error', 'Esa etapa no existe.')

    const nuevo = await tx.execute(sql`
      insert into contacts
        (tenant_id, display_name, phone, city, asunto, stage_id, source,
         last_activity_at)
      values (${session.tenantId}, ${nombre}, ${phone || null},
              ${city || null}, ${asunto || null}, ${stageId}, 'manual', now())
      returning id
    `)
    const contactId = String(nuevo.rows[0]!.id)

    // La primera etapa también es un movimiento: sin esta fila el contacto
    // no aparece en el embudo acumulado del reporte.
    await tx.execute(sql`
      insert into stage_history (tenant_id, contact_id, to_stage_id, changed_by, reason)
      values (${session.tenantId}, ${contactId}, ${stageId}, ${session.userId},
              'alta manual')
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId}, 'contact.created',
              'contact', ${contactId})
    `)
  })

  revalidatePath('/contactos')
  volver('ok', `${nombre} quedó cargado.`)
}
