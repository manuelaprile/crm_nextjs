/**
 * ¿Está vivo el panel y llega a la base?
 *
 * Lo consulta `./crm.sh actualizar` después de cambiar el contenedor. Si no
 * contesta OK, el script vuelve solo a la versión anterior. Sin esto un
 * deploy roto se descubre cuando lo avisa un cliente.
 *
 * Se responde a propósito SIN detalle: es alcanzable desde internet a través
 * de Caddy, y la versión del código o el estado del esquema no son cosas para
 * publicarle a cualquiera que pruebe la URL. Lo único que importa afuera es
 * si el proceso puede atender; el diagnóstico se hace por registro.
 *
 * La consulta va por el mismo pool que usa la app, no por una conexión
 * aparte: una contraseña mal puesta o un pool agotado tienen que hacerlo
 * fallar, que es justo lo que queremos detectar.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { withoutTenant } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    // `tenants` y no `select 1`: así prueba la conexión Y que el esquema
    // esté puesto. Una base sin migrar hace fallar la consulta, que es
    // exactamente el deploy que no hay que dejar arriba.
    //
    // Sin contexto de tenant, RLS deja la consulta en CERO filas. Está bien:
    // acá interesa que la consulta no explote, no que devuelva algo.
    await withoutTenant((tx) => tx.execute(sql`select 1 from tenants limit 1`))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
