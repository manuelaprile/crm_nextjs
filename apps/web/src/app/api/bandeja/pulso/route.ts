/**
 * Latido de la bandeja: "¿pasó algo desde la última vez?".
 *
 * Devuelve una marca que cambia cuando entra o sale un mensaje, más lo justo
 * para poder avisar: cuántos sin leer hay y quién fue el último en escribir.
 * El cliente compara la marca con la que tenía y, si cambió, refresca la
 * pantalla y muestra el aviso.
 *
 * Es polling, sí, pero la alternativa —WebSockets o SSE— obliga a un proceso
 * con estado, y hoy la app corre detrás de Caddy en un contenedor que se
 * recrea en cada deploy. Para una bandeja con dos o tres personas mirándola,
 * dos índices cada cinco segundos no se notan.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { AuthError, requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  let session
  try {
    session = await requireTenant()
  } catch (err) {
    if (err instanceof AuthError) {
      // 401 y no 500: la sesión vencida en una pestaña abierta desde ayer no
      // es un error del servidor, y el cliente tiene que poder distinguirlo
      // para dejar de latir en vez de reintentar cada cinco segundos.
      return NextResponse.json({ error: 'sin sesión' }, { status: 401 })
    }
    throw err
  }

  const datos = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select
        (select max(created_at) from messages) as mensaje,
        (select max(last_message_at) from conversations) as conversacion,
        (select coalesce(sum(unread_count), 0)::int from conversations
          where archived_at is null) as sin_leer
    `)
    const row = res.rows[0] as {
      mensaje: string | Date | null
      conversacion: string | Date | null
      sin_leer: number
    }

    // El último mensaje ENTRANTE, que es de lo único que hay que avisar.
    // Un mensaje que mandamos nosotros no es una novedad para quien lo mandó.
    const ult = await tx.execute(sql`
      select m.id, m.conversation_id, m.body, m.type,
             coalesce(c.participant_name, c.participant_phone, 'Alguien') as quien
        from messages m
        join conversations c on c.id = m.conversation_id
       where m.direction = 'inbound'
       order by m.created_at desc
       limit 1
    `)
    const u = ult.rows[0] as
      | { id: string; conversation_id: string; body: string | null; type: string; quien: string }
      | undefined

    return {
      marca: `${fecha(row.mensaje)}|${fecha(row.conversacion)}`,
      sinLeer: Number(row.sin_leer ?? 0),
      ultimo: u
        ? {
            id: String(u.id),
            conversacionId: String(u.conversation_id),
            quien: String(u.quien),
            texto: resumen(u.body, u.type),
          }
        : null,
    }
  })

  return NextResponse.json(datos, {
    // Sin esto, el navegador sirve la respuesta de su cache y el latido queda
    // congelado en el primer valor: la pantalla no se actualiza nunca y no hay
    // forma de darse cuenta mirando el servidor.
    headers: { 'cache-control': 'no-store' },
  })
}

/** Un renglón, no el mensaje entero: es un aviso, no la conversación. */
function resumen(body: string | null, type: string): string {
  const t = body?.trim()
  if (t) return t.length > 90 ? `${t.slice(0, 90)}…` : t
  switch (type) {
    case 'image':
      return '📷 Foto'
    case 'video':
      return '🎥 Video'
    case 'audio':
      return '🎤 Audio'
    case 'document':
      return '📎 Archivo'
    case 'sticker':
      return 'Sticker'
    default:
      return 'Mensaje nuevo'
  }
}

function fecha(v: string | Date | null): string {
  if (!v) return '0'
  return v instanceof Date ? String(v.getTime()) : v
}
