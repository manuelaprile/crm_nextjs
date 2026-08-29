'use server'

/**
 * Derivar una conversación: pasársela a alguien del equipo.
 *
 * Solo owner/admin, que es el permiso pedido: un operador recibe
 * conversaciones, no las reparte. Las consultas —quién la tiene, quién la
 * tuvo— viven en `asignacion.ts`.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant } from './db/client'

/**
 * El destino no se toma del formulario: llega un id de conversación y la
 * ruta se arma acá. Un campo escondido con la URL de vuelta es una
 * redirección abierta.
 */
function volverAlChat(id: string, tipo: 'ok' | 'error', msg: string): never {
  const sp = new URLSearchParams({ r: tipo, m: msg.slice(0, 200) })
  redirect(`/bandeja/${encodeURIComponent(id)}?${sp.toString()}`)
}

type Derivacion = { error: string } | { ok: true }

/**
 * Derivar: pasarle la conversación a alguien, o devolverla al montón.
 *
 * `userId` vacío significa dejarla sin asignar, y eso se registra igual que
 * una derivación. Un hilo que vuelve a estar libre es información: alguien
 * lo soltó, y en algún momento va a importar saber quién y cuándo.
 */
export async function derivarConversacion(formData: FormData): Promise<void> {
  // Un `agent` no llega acá desde la pantalla —no se le dibuja el
  // formulario— pero la defensa es esta, no la interfaz.
  const session = await requireAdmin()
  const conversationId = String(formData.get('conversationId') ?? '').trim()
  const userId = String(formData.get('userId') ?? '').trim() || null
  if (!conversationId) return

  const resultado: Derivacion = await withTenant(session, async (tx) => {
    // RLS ya acota la conversación a la cuenta; esto es para poder decir
    // "no existe" en vez de actualizar cero filas en silencio.
    const actual = await tx.execute(sql`
      select assigned_user_id from conversations where id = ${conversationId}
    `)
    if (!actual.rows.length) return { error: 'Esa conversación no existe.' }
    const antes = actual.rows[0]!.assigned_user_id
      ? String(actual.rows[0]!.assigned_user_id)
      : null

    // El destinatario tiene que ser de ESTA cuenta. Sin esto, un id de
    // usuario cualquiera pegado en el formulario deja la conversación a
    // cargo de alguien que no puede verla, y nadie se entera.
    if (userId) {
      const miembro = await tx.execute(sql`
        select u.name, u.disabled_at
          from tenant_users tu
          join users u on u.id = tu.user_id
         where tu.user_id = ${userId} and u.is_superadmin = false
      `)
      if (!miembro.rows.length) {
        return { error: 'Ese usuario no es de esta cuenta.' }
      }
      if (miembro.rows[0]!.disabled_at) {
        return {
          error: 'Ese usuario está deshabilitado: no puede recibir conversaciones.',
        }
      }
    }

    // Guardar lo mismo que ya estaba no es un cambio: no tiene por qué
    // dejar una fila en el historial.
    if (antes === userId) return { ok: true }

    await tx.execute(sql`
      update conversations set assigned_user_id = ${userId}
       where id = ${conversationId}
    `)
    await tx.execute(sql`
      insert into conversation_assignments
        (tenant_id, conversation_id, from_user_id, to_user_id, changed_by)
      values (${session.tenantId}, ${conversationId}, ${antes}, ${userId},
              ${session.userId})
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
      values (${session.tenantId}, ${session.userId}, 'conversacion.derivada',
              'conversation', ${conversationId},
              ${JSON.stringify({ de: antes, a: userId })}::jsonb)
    `)
    return { ok: true }
  })

  if ('error' in resultado) {
    volverAlChat(conversationId, 'error', resultado.error)
  }

  // Cuando sale bien NO se redirige. Redirigir reescribe la URL y ahí viven
  // los filtros de la bandeja: asignar desde "las de Ana" te devolvía a la
  // lista completa. Y el cartel de confirmación no hacía falta: el
  // desplegable ya muestra el nombre nuevo y abajo aparece la línea del
  // historial. El error sí redirige, porque ahí hay algo que leer.
  revalidatePath('/bandeja')
  revalidatePath(`/bandeja/${conversationId}`)
}
