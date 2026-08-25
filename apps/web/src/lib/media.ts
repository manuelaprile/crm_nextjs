/**
 * Adjuntos entrantes: bajarlos, guardarlos y —si son audio— transcribirlos.
 *
 * Hay un reloj: WhatsApp borra el archivo de sus servidores al poco tiempo de
 * recibido. Textual de la documentación de Zernio: *"Download and store the
 * bytes when this webhook arrives: Meta drops inbound media after a limited
 * retention window, after which the endpoint answers 400 permanently and the
 * media is unrecoverable."*
 *
 * Por eso se baja EN EL MOMENTO de la ingesta y no cuando alguien abre la
 * conversación. Guardar el link para después es perder el archivo.
 */
import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import { isSealed, open as openSecret, type SealedValue } from './crypto'

/**
 * Tope por archivo. Arriba de esto se guarda la ficha y no el contenido.
 *
 * WhatsApp acepta hasta 16MB en fotos y audio, y hasta 100MB en documentos.
 * Un video de 100MB por conversación en una base que se respalda entera todas
 * las noches no es razonable. 25MB cubre con holgura fotos, audios y la
 * enorme mayoría de los PDF; lo que se pase queda registrado y visible.
 */
const MEDIA_MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 25 * 1024 * 1024)

/** Cuánto se espera la descarga. Un adjunto colgado no puede frenar la ingesta. */
const DESCARGA_TIMEOUT_MS = 30_000

export type AdjuntoEntrante = {
  kind: string
  url: string
  mime?: string | null
  filename?: string | null
  /** Cabeceras para bajarlo. El endpoint de Zernio pide `Authorization`. */
  headers?: Record<string, string>
}

/**
 * Baja y guarda un adjunto. NUNCA lanza.
 *
 * Que falle la descarga de una foto no puede impedir que el mensaje entre a
 * la bandeja: el paciente escribió y alguien tiene que atenderlo, con foto o
 * sin ella. El error queda en la fila y se ve en la conversación.
 */
export async function guardarAdjunto(params: {
  tenantId: string
  messageId: string
  adjunto: AdjuntoEntrante
}): Promise<void> {
  const { tenantId, messageId, adjunto } = params

  let bytes: Buffer | null = null
  let mime = adjunto.mime ?? null
  let error: string | null = null

  try {
    const res = await fetch(adjunto.url, {
      headers: adjunto.headers ?? {},
      signal: AbortSignal.timeout(DESCARGA_TIMEOUT_MS),
    })
    if (!res.ok) {
      error =
        res.status === 400 || res.status === 404
          ? 'WhatsApp ya no tiene este archivo disponible.'
          : `No se pudo descargar (error ${res.status}).`
    } else {
      // El tamaño se chequea ANTES de leer el cuerpo cuando el servidor lo
      // declara: bajar 100MB para después descartarlos es tiempo y memoria
      // regalados en el camino caliente de la ingesta.
      const declarado = Number(res.headers.get('content-length') ?? 0)
      if (declarado > MEDIA_MAX_BYTES) {
        error = `El archivo pesa ${mb(declarado)} y el máximo son ${mb(MEDIA_MAX_BYTES)}.`
      } else {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.byteLength > MEDIA_MAX_BYTES) {
          error = `El archivo pesa ${mb(buf.byteLength)} y el máximo son ${mb(MEDIA_MAX_BYTES)}.`
        } else {
          bytes = buf
          mime = mime ?? res.headers.get('content-type')
        }
      }
    }
  } catch (err) {
    error =
      String(err).includes('TimeoutError') || String(err).includes('aborted')
        ? 'La descarga tardó demasiado.'
        : 'No se pudo descargar el archivo.'
    console.error('[media] falló la descarga', { messageId, err })
  }

  const id = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      insert into message_media
        (tenant_id, message_id, kind, mime, filename, size_bytes, bytes, error)
      values (${tenantId}, ${messageId}, ${adjunto.kind}, ${mime},
              ${adjunto.filename ?? null}, ${bytes?.byteLength ?? null},
              ${bytes}, ${error})
      returning id
    `)
    return String(res.rows[0]!.id)
  })

  // La transcripción va DESPUÉS de guardar y sin await del lado de quien
  // ingesta: si OpenAI tarda o falla, el audio ya está a salvo.
  if (bytes && adjunto.kind === 'audio') {
    void transcribirYGuardar(id, tenantId, bytes, mime).catch((err) =>
      console.error('[media] falló la transcripción', err),
    )
  }
}

function mb(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------
// Transcripción de audio
// ---------------------------------------------------------------------

/**
 * Pasa un audio a texto con Whisper.
 *
 * Solo OpenAI: Anthropic no tiene API de audio. Se usa la clave del
 * consultorio si cargó una de OpenAI, y si no la de la plataforma. Sin
 * ninguna de las dos no se transcribe y se dice por qué — quedarse callado
 * haría parecer que el audio llegó vacío.
 */
async function transcribirYGuardar(
  mediaId: string,
  tenantId: string,
  bytes: Buffer,
  mime: string | null,
): Promise<void> {
  const apiKey = await claveOpenAI(tenantId)
  if (!apiKey) {
    await withSystem((tx) =>
      tx.execute(sql`
        update message_media
           set error = 'Para transcribir audios hace falta una clave de OpenAI en Configuración → Inteligencia artificial.'
         where id = ${mediaId}
      `),
    )
    return
  }

  try {
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: mime ?? 'audio/ogg' }),
      nombreParaWhisper(mime),
    )
    form.append('model', 'whisper-1')
    // Sin esto tiende a "detectar" inglés en audios cortos o con ruido.
    form.append('language', 'es')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })

    if (!res.ok) {
      const detalle = (await res.text()).slice(0, 200)
      throw new Error(`OpenAI ${res.status}: ${detalle}`)
    }
    const data = (await res.json()) as { text?: string }
    const texto = data.text?.trim()

    await withSystem((tx) =>
      tx.execute(sql`
        update message_media
           set transcript = ${texto || null},
               error = ${texto ? null : 'El audio no tenía voz reconocible.'}
         where id = ${mediaId}
      `),
    )

    if (texto) await atenderAudioTranscripto(mediaId, texto)
  } catch (err) {
    console.error('[media] transcripción falló', err)
    await withSystem((tx) =>
      tx.execute(sql`
        update message_media set error = 'No se pudo transcribir el audio.'
         where id = ${mediaId}
      `),
    )
  }
}

/**
 * Whisper decide el formato por la extensión del nombre del archivo, así que
 * mandar "audio" a secas hace que rechace el pedido.
 */
function nombreParaWhisper(mime: string | null): string {
  const m = (mime ?? '').toLowerCase()
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3'
  if (m.includes('mp4') || m.includes('m4a')) return 'audio.m4a'
  if (m.includes('wav')) return 'audio.wav'
  if (m.includes('webm')) return 'audio.webm'
  // WhatsApp manda las notas de voz en ogg/opus.
  return 'audio.ogg'
}

async function claveOpenAI(tenantId: string): Promise<string | null> {
  const fila = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select provider, api_key_enc from agent_configs
       where tenant_id = ${tenantId} and provider = 'openai'
       limit 1
    `)
    return res.rows[0] as { api_key_enc: unknown } | undefined
  })

  if (fila && isSealed(fila.api_key_enc)) {
    try {
      const propia = openSecret(fila.api_key_enc as SealedValue).trim()
      if (propia) return propia
    } catch (err) {
      console.error('[media] clave de OpenAI ilegible', err)
    }
  }
  return process.env.OPENAI_API_KEY?.trim() || null
}

// ---------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------

export type Adjunto = {
  id: string
  kind: string
  mime: string | null
  filename: string | null
  sizeBytes: number | null
  transcript: string | null
  error: string | null
  /** Si el contenido está guardado y se puede mostrar o descargar. */
  hayArchivo: boolean
}

/**
 * Los adjuntos de una tanda de mensajes, para pintarlos en la conversación.
 *
 * Los ids van PARAMETRIZADOS, no interpolados. Hoy salen de nuestra propia
 * consulta, pero armar el array a mano dentro de un sql.raw es una inyección
 * esperando a que alguien reuse la función con otra fuente.
 */
export async function adjuntosDe(
  messageIds: string[],
): Promise<Map<string, Adjunto[]>> {
  const salida = new Map<string, Adjunto[]>()
  if (!messageIds.length) return salida

  const filas = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select id, message_id, kind, mime, filename, size_bytes, transcript,
             error, (bytes is not null) as hay_archivo
        from message_media
       where message_id = any(${messageIds}::uuid[])
       order by created_at
    `)
    return res.rows as Record<string, unknown>[]
  })

  for (const f of filas) {
    const mid = String(f.message_id)
    const lista = salida.get(mid) ?? []
    lista.push({
      id: String(f.id),
      kind: String(f.kind),
      mime: f.mime ? String(f.mime) : null,
      filename: f.filename ? String(f.filename) : null,
      sizeBytes: f.size_bytes ? Number(f.size_bytes) : null,
      transcript: f.transcript ? String(f.transcript) : null,
      error: f.error ? String(f.error) : null,
      hayArchivo: Boolean(f.hay_archivo),
    })
    salida.set(mid, lista)
  }
  return salida
}

/**
 * Lo que pasa cuando un audio termina de transcribirse.
 *
 * Sin esto, la transcripción quedaba de adorno: un paciente manda una nota de
 * voz, el mensaje entra con `body` en null, y el agente NI SIQUIERA CORRE
 * —la ingesta exige texto para dispararlo—. Desde afuera: la IA contesta
 * todos los mensajes escritos y se queda muda con los audios, sin ningún
 * error en ningún lado.
 *
 * La transcripción se escribe en `body` porque es, literalmente, lo que la
 * persona dijo. Eso la hace aparecer en la vista previa de la bandeja, en el
 * buscador y en el historial que ve el agente, sin tocar nada de eso.
 *
 * Solo si `body` estaba vacío: si el audio venía con un texto al lado, ese
 * texto es lo que la persona escribió y no se pisa.
 */
async function atenderAudioTranscripto(
  mediaId: string,
  texto: string,
): Promise<void> {
  const fila = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      update messages m
         set body = ${texto}
        from message_media mm
       where mm.id = ${mediaId}
         and m.id = mm.message_id
         and m.body is null
         and m.direction = 'inbound'
      returning m.conversation_id
    `)
    return res.rows[0] as { conversation_id: string } | undefined
  })
  if (!fila) return

  // El agente corre recién ahora, cuando por fin hay algo que leer. El
  // import es dinámico para no arrastrar el grafo del agente adentro del
  // camino de la ingesta, que tiene presupuesto de segundos.
  const { runAgentForConversation } = await import('./agent')
  void runAgentForConversation(String(fila.conversation_id)).catch((err) =>
    console.error('[media] el agente falló tras transcribir', err),
  )
}
