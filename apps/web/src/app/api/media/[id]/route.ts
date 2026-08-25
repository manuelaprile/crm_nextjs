/**
 * Sirve un adjunto de una conversación.
 *
 * Son fotos y audios de pacientes: la ruta va con sesión y la consulta va por
 * `withTenant`, así que RLS es quien decide, no un `where` que alguien puede
 * olvidar. Con la URL de un adjunto de otro consultorio, la fila simplemente
 * no existe y devuelve 404.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { AuthError, requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Solo tipos que el navegador puede mostrar sin ejecutar nada. */
const SEGUROS = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/3gpp',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm',
  'application/pdf',
])

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // `requireTenant` lanza si no hay sesión, y sin capturarlo esto devuelve
  // 500. En una ruta que va adentro de un <img src>, cada visita vencida
  // dejaría un error de servidor en el registro que no es un error.
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
      select mime, filename, bytes from message_media where id = ${id}
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
  // de renderizarse. Un HTML o un SVG servidos en línea desde nuestro dominio
  // ejecutarían scripts con la sesión del usuario puesta.
  const seguro = SEGUROS.has(mime)
  const nombre = (fila.filename ?? 'archivo').replace(/["\r\n]/g, '')
  // Dos formas del nombre a propósito. La cabecera HTTP viaja en Latin-1, así
  // que "estudio médico.pdf" llega con la tilde rota. `filename*` (RFC 5987)
  // lleva el nombre real en UTF-8 y lo entienden todos los navegadores
  // actuales; `filename` queda como respaldo, sin acentos, para los demás.
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
      // Privado: es contenido de un paciente. Que no quede en ninguna caché
      // compartida ni en un proxy intermedio.
      'cache-control': 'private, max-age=3600, no-transform',
      'x-content-type-options': 'nosniff',
    },
  })
}
