/**
 * Latido de la bandeja: "¿pasó algo desde la última vez?".
 *
 * Devuelve una marca que cambia cuando entra o sale un mensaje. El cliente la
 * compara con la que tenía y, si cambió, refresca la pantalla. Es polling, sí,
 * pero la alternativa —WebSockets o SSE— obliga a un proceso con estado, y hoy
 * la app corre detrás de Caddy en un contenedor que se recrea en cada deploy.
 * Para una bandeja con dos o tres personas mirándola, dos índices cada cinco
 * segundos no se notan.
 *
 * Las dos consultas van contra índices que ya existen
 * (`messages (tenant_id, created_at desc)` y
 * `conversations (tenant_id, last_message_at desc)`), así que es una lectura de
 * la punta de cada uno, no un conteo.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const session = await requireTenant()

  const marca = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select
        (select max(created_at) from messages) as mensaje,
        (select max(last_message_at) from conversations) as conversacion
    `)
    const row = res.rows[0] as {
      mensaje: string | Date | null
      conversacion: string | Date | null
    }
    return `${fecha(row.mensaje)}|${fecha(row.conversacion)}`
  })

  return NextResponse.json(
    { marca },
    // Sin esto, el navegador sirve la respuesta de su cache y el latido queda
    // congelado en el primer valor: la pantalla no se actualiza nunca y no hay
    // forma de darse cuenta mirando el servidor.
    { headers: { 'cache-control': 'no-store' } },
  )
}

function fecha(v: string | Date | null): string {
  if (!v) return '0'
  return v instanceof Date ? String(v.getTime()) : v
}
