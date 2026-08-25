/**
 * Webhook de Zernio.
 *
 * Igual que el del canal oficial, esta ruta SÍ está expuesta a internet: es
 * Zernio quien nos llama. La única defensa real es la firma sobre el cuerpo
 * crudo, que se verifica siempre y antes de mirar el contenido.
 *
 * Zernio desactiva un webhook a los 10 fallos seguidos de entrega, así que
 * cualquier cosa que no sepamos procesar se responde 200 y se ignora. Un 500
 * repetido nos dejaría sin mensajes y sin aviso.
 */
import { NextResponse } from 'next/server'
import {
  cabecerasDeDescarga,
  cuentaPorId,
  firmaValida,
  payloadDe,
  traducirEntrante,
} from '@/lib/zernio'
import { guardarAdjunto } from '@/lib/media'
import { mensajePorExternalId } from '@/lib/media-ingesta'
import { procesarEntrante } from '@/lib/ingest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  // El cuerpo CRUDO, antes de parsearlo: la firma se calcula sobre los bytes
  // exactos. Un `await req.json()` + `JSON.stringify` da otro texto y la
  // firma no valida nunca.
  const crudo = await req.text()

  if (!firmaValida(crudo, req.headers.get('x-zernio-signature'))) {
    console.error('[zernio] webhook con firma inválida')
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 })
  }

  const entrante = traducirEntrante(cuerpo)
  // No es un error: llegan estados de entrega, ecos de lo que mandamos
  // nosotros, eventos de plantillas y de números. Todavía no los usamos.
  if (!entrante) return NextResponse.json({ ok: true, ignorado: true })

  try {
    const cuenta = await cuentaPorId(entrante.cuentaZernio)
    if (!cuenta) {
      console.error('[zernio] cuenta desconocida', entrante.cuentaZernio)
      return NextResponse.json({ ok: true, ignorado: true })
    }
    const res = await procesarEntrante(payloadDe(cuenta, entrante), 'zernio')

    // Los adjuntos se bajan YA, no cuando alguien abra la conversación.
    // WhatsApp los borra de sus servidores a los pocos días y después el
    // endpoint responde 400 para siempre: el archivo es irrecuperable.
    if (res.estado === 'ok' && entrante.adjuntos.length) {
      const messageId = await mensajePorExternalId(entrante.mensajeId)
      if (messageId) {
        for (const a of entrante.adjuntos) {
          await guardarAdjunto({
            tenantId: cuenta.tenantId,
            messageId,
            adjunto: { ...a, headers: cabecerasDeDescarga() },
          })
        }
      }
    }
  } catch (err) {
    console.error('[zernio] error procesando el mensaje', err)
  }

  // Siempre 200. El evento ya quedó reclamado en `webhook_events` con su
  // error si falló, y la idempotencia ya está resuelta ahí.
  return NextResponse.json({ ok: true })
}
