/**
 * Webhook de la Cloud API de Meta.
 *
 * A diferencia de `/api/ingest/baileys`, esta ruta SÍ está expuesta a
 * internet: es Meta quien nos llama, desde sus servidores. Por eso la única
 * defensa real es la firma del cuerpo, que se verifica siempre y antes de
 * mirar nada del contenido.
 *
 * El GET es el apretón de manos de alta que Meta hace una sola vez cuando se
 * carga la URL en el panel de la aplicación.
 */
import { NextResponse } from 'next/server'
import {
  cuentaPorNumero,
  firmaValida,
  payloadDe,
  traducirEntrante,
  verificarAlta,
} from '@/lib/cloud'
import { procesarEntrante } from '@/lib/ingest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const desafio = verificarAlta(new URL(req.url).searchParams)
  if (!desafio) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 403 })
  }
  // Meta espera el desafío como texto pelado, no como JSON.
  return new Response(desafio, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })
}

export async function POST(req: Request) {
  // El cuerpo CRUDO, antes de parsearlo: la firma se calcula sobre los bytes
  // exactos que mandó Meta. Un `await req.json()` seguido de un
  // `JSON.stringify` daría otro texto y la firma nunca coincidiría.
  const crudo = await req.text()

  if (!firmaValida(crudo, req.headers.get('x-hub-signature-256'))) {
    console.error('[cloud] webhook con firma inválida')
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 })
  }

  const entrantes = traducirEntrante(cuerpo)

  // Un webhook puede traer estados de entrega, plantillas aprobadas y otras
  // novedades que todavía no procesamos. No son un error: se responde 200 y
  // se ignoran, si no Meta reintenta para siempre y termina desactivando la
  // suscripción.
  for (const entrante of entrantes) {
    try {
      const cuenta = await cuentaPorNumero(entrante.numeroId)
      if (!cuenta) {
        console.error('[cloud] número desconocido', entrante.numeroId)
        continue
      }
      await procesarEntrante(payloadDe(cuenta, entrante), 'cloud_api')
    } catch (err) {
      // Un mensaje que falla no puede arrastrar a los otros del mismo lote.
      // El evento ya quedó reclamado en `webhook_events` con su error, y el
      // barrido de recuperación lo levanta.
      console.error('[cloud] error procesando un mensaje', err)
    }
  }

  // Siempre 200. Meta reintenta ante cualquier otra cosa, y reintentar un
  // mensaje que ya guardamos no aporta nada: la idempotencia ya está resuelta
  // por `webhook_events`.
  return NextResponse.json({ ok: true })
}
