import { leerLogo } from '@/lib/comercio'

export const dynamic = 'force-dynamic'

/**
 * El logo de la cuenta activa.
 *
 * No recibe ningún id: el tenant sale de la sesión. Así nadie puede pedir el
 * logo de otro cliente cambiando un número en la URL, que es exactamente lo
 * que pasaría con /api/marca/logo/<tenantId>.
 *
 * La caché es privada: los logos son distintos por sesión, y un proxy
 * compartido que guarde uno se lo mostraría a otro cliente.
 */
export async function GET() {
  const logo = await leerLogo()
  if (!logo) return new Response('sin logo', { status: 404 })

  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      'Content-Type': logo.mime,
      'Content-Length': String(logo.bytes.length),
      'Cache-Control': 'private, max-age=300',
    },
  })
}
