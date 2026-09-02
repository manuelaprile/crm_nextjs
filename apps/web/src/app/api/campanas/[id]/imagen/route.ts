/**
 * Sirve la imagen adjunta de una campaña.
 *
 * Misma estructura que `/api/conocimiento/[id]`: sesión, y la consulta por
 * `withTenant` para que decida RLS y no un `where` que alguien puede
 * olvidarse de escribir. Cambiar el uuid en la URL no muestra la imagen de
 * otro cliente ni acertando uno válido.
 *
 * Además verifica el MÓDULO: una cuenta a la que le dieron de baja Campañas
 * no tiene por qué seguir sirviendo sus imágenes por una URL que alguien
 * guardó.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { AuthError, requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'
import { moduloActivo } from '@/lib/modulos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Lista blanca. Es lo único que `guardarCampana` deja subir. */
const SEGUROS = new Set(['image/jpeg', 'image/png'])

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session
  try {
    session = await requireTenant()
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'sin sesión' }, { status: 401 })
    }
    throw err
  }

  if (!(await moduloActivo('modulo-campanas', session.tenantId))) {
    return NextResponse.json({ error: 'no existe' }, { status: 404 })
  }

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'no existe' }, { status: 404 })
  }

  const fila = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select imagen_mime, imagen from campanas where id = ${id}
    `)
    return res.rows[0] as
      | { imagen_mime: string | null; imagen: Buffer | null }
      | undefined
  })

  const mime = (fila?.imagen_mime ?? '').split(';')[0]!.trim().toLowerCase()
  if (!fila?.imagen || !SEGUROS.has(mime)) {
    return NextResponse.json({ error: 'no existe' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(fila.imagen), {
    status: 200,
    headers: {
      'content-type': mime,
      'content-length': String(fila.imagen.byteLength),
      // Privada: la imagen es de esta cuenta y un proxy compartido que la
      // guarde se la mostraría a otro cliente.
      'cache-control': 'private, max-age=300, no-transform',
      'x-content-type-options': 'nosniff',
    },
  })
}
