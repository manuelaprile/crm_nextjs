/**
 * Ingesta de mensajes entrantes desde el worker de WhatsApp.
 *
 * Ruta interna: solo la llama wa-worker por la red de Docker. No está expuesta
 * por Caddy. Igual va autenticada con bearer, porque "está en la red interna"
 * deja de ser cierto el día que alguien levanta otro contenedor.
 *
 * La lógica de procesamiento vive en `lib/ingest.ts` para que el simulador de
 * `/pruebas` ejercite el mismo camino. Acá solo queda el transporte HTTP.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { withSystem } from '@/lib/db/client'
import { safeEqual } from '@/lib/auth'
import { procesarEntrante, type InboundPayload } from '@/lib/ingest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const INGEST_SECRET = process.env.INGEST_SECRET ?? ''

function autorizado(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  // Fail-closed: sin secreto configurado se rechaza todo, no se acepta todo.
  return Boolean(INGEST_SECRET) && safeEqual(token, INGEST_SECRET)
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  let payload: InboundPayload
  try {
    payload = (await req.json()) as InboundPayload
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 })
  }

  if (!payload.eventId || !payload.accountId) {
    return NextResponse.json({ error: 'payload incompleto' }, { status: 400 })
  }

  try {
    const res = await procesarEntrante(payload)
    if (res.estado === 'duplicado') {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    // El evento queda reclamado pero sin processed_at: el barrido de
    // recuperación (GET de esta misma ruta) lo levanta después.
    console.error('[ingesta] error', err)
    return NextResponse.json({ error: 'error al procesar' }, { status: 500 })
  }
}

/**
 * Red de seguridad: devuelve los eventos reclamados que nunca se procesaron.
 * Si el proceso muere entre el claim y el commit, quedan acá.
 */
export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const stuck = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select event_id, provider, kind, received_at, error
        from webhook_events
       where processed_at is null
         and received_at < now() - interval '2 minutes'
       order by received_at
       limit 100
    `)
    return res.rows
  })

  return NextResponse.json({ stuck })
}
