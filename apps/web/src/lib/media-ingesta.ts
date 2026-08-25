import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'

/**
 * El id interno del mensaje que acaba de entrar, buscado por el id que le dio
 * el proveedor.
 *
 * `procesarEntrante` no lo devuelve —devuelve la conversación— y el adjunto
 * tiene que colgar del mensaje, no del hilo: en una conversación puede haber
 * veinte fotos y cada una pertenece a su mensaje.
 */
export async function mensajePorExternalId(
  externalId: string,
): Promise<string | null> {
  return withSystem(async (tx) => {
    const res = await tx.execute(
      sql`select id from messages where external_id = ${externalId} limit 1`,
    )
    const fila = res.rows[0] as { id: string } | undefined
    return fila ? String(fila.id) : null
  })
}
