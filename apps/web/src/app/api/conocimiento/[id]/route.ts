/**
 * Sirve un archivo de la información del negocio.
 *
 * Existe para poder ABRIR lo que se subió. Sin esto, el dueño ve el nombre
 * del archivo y el texto que se extrajo, pero no tiene forma de comparar uno
 * con otro — y comparar es justamente lo que hay que poder hacer antes de
 * que el asistente empiece a decir esos precios.
 *
 * Misma estructura que `/api/media/[id]`: sesión, y la consulta por
 * `withTenant` para que decida RLS y no un `where` que alguien puede
 * olvidarse de escribir.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { AuthError, requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Solo tipos que el navegador puede mostrar sin ejecutar nada. */
const SEGUROS = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
])

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

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'no existe' }, { status: 404 })
  }

  const fila = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select mime, filename, bytes from business_knowledge_files
       where id = ${id}
    `)
    return res.rows[0] as
      | { mime: string | null; filename: string | null; bytes: Buffer | null }
      | undefined
  })

  if (!fila?.bytes) {
    return NextResponse.json({ error: 'no existe' }, { status: 404 })
  }

  const mime = (fila.mime ?? '').split(';')[0]!.trim().toLowerCase()
  // Lo que el navegador no puede mostrar de forma segura se descarga en vez
  // de renderizarse: un HTML o un SVG servidos en línea desde nuestro
  // dominio ejecutarían scripts con la sesión del usuario puesta.
  const seguro = SEGUROS.has(mime)
  const nombre = (fila.filename ?? 'archivo').replace(/["\r\n]/g, '')
  // La cabecera HTTP viaja en Latin-1: `filename*` (RFC 5987) lleva el
  // nombre real en UTF-8 y `filename` queda de respaldo, sin acentos.
  const ascii = nombre.replace(/[^ -~]/g, '_')
  const utf8 = encodeURIComponent(nombre)

  return new NextResponse(new Uint8Array(fila.bytes), {
    status: 200,
    headers: {
      'content-type': seguro ? mime : 'application/octet-stream',
      'content-disposition':
        `${seguro ? 'inline' : 'attachment'}; ` +
        `filename="${ascii}"; filename*=UTF-8''${utf8}`,
      'content-length': String(fila.bytes.byteLength),
      'cache-control': 'private, max-age=3600, no-transform',
      'x-content-type-options': 'nosniff',
    },
  })
}
