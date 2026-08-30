/**
 * Pasar un archivo a texto: PDF, imagen o texto plano.
 *
 * POR QUÉ ACÁ Y NO EN `provider.ts`
 * `AIProvider` modela una conversación con herramientas. Esto es otra cosa:
 * una llamada suelta, sin historial y sin tools, que entra un archivo y sale
 * un texto. Meterla en la misma interfaz obligaría a que todo proveedor la
 * implemente, y el simulado no tiene nada que leer.
 *
 * POR QUÉ SE LEE UNA SOLA VEZ
 * Mandar el PDF en cada conversación sería pagar la lista de precios entera
 * en cada mensaje de cada persona, todos los días. Acá se convierte a texto
 * cuando se sube y de ahí en adelante el sistema trabaja con texto. Es lo
 * mismo que hace `transcribirYGuardar` con los audios de WhatsApp.
 *
 * NUNCA LANZA. Devuelve `{ texto }` o `{ error }`. Que no se pueda leer un
 * archivo es un resultado posible y hay que poder mostrarlo en la pantalla;
 * una excepción para arriba dejaría la fila colgada en "leyendo" para
 * siempre.
 */
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { sql } from 'drizzle-orm'
import { withSystem } from '../db/client'
import { isSealed, open as openSecret, type SealedValue } from '../crypto'
import { estimateCost } from './models'

/** Tope de lo que se guarda por archivo. Ver TOPE_NEGOCIO en conocimiento.ts. */
export const MAX_TEXTO = 20_000

/** Cuánto se espera al modelo. Un PDF de cuarenta páginas tarda. */
const TIMEOUT_MS = 180_000

/**
 * Con qué modelo se lee.
 *
 * NO es el que el cliente eligió para atender. Ahí conviene el más barato
 * —calificar y derivar no necesita más—, pero acá se transcribe una lista de
 * precios UNA vez, y un precio mal leído lo va a decir el asistente con toda
 * seguridad durante meses. Es el lugar del sistema donde menos conviene
 * ahorrar: se paga una sola vez por archivo.
 */
const MODELO_LECTOR: Record<string, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o',
}

const IMAGENES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const TEXTOS = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
])

/** Lo que se acepta subir. Lo usa el `accept` del formulario y la validación. */
export const EXTENSIONES = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv'

export type Lectura = { texto: string } | { error: string }

/**
 * Qué es este archivo, en serio.
 *
 * El navegador manda el mime que le parece y para `.md` o `.csv` manda
 * cualquier cosa —o nada—. La extensión resulta más confiable que el
 * `Content-Type` que llega del cliente, así que manda ella cuando el mime no
 * dice nada útil.
 */
export function tipoDeArchivo(
  filename: string,
  mime: string | null,
): 'pdf' | 'imagen' | 'texto' | null {
  const m = (mime ?? '').split(';')[0]!.trim().toLowerCase()
  const ext = filename.toLowerCase().split('.').pop() ?? ''

  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (IMAGENES.has(m)) return 'imagen'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'imagen'
  if (TEXTOS.has(m) || m.startsWith('text/')) return 'texto'
  if (['txt', 'md', 'csv'].includes(ext)) return 'texto'
  return null
}

/** El mime que se le declara al modelo. El del navegador puede venir vacío. */
function mimeDeImagen(filename: string, mime: string | null): string {
  const m = (mime ?? '').split(';')[0]!.trim().toLowerCase()
  if (IMAGENES.has(m)) return m
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

/**
 * La consigna.
 *
 * "Transcribí" y no "resumí" es la palabra importante. Un resumen de una
 * lista de precios es una lista de precios incompleta, y el asistente no
 * tiene forma de saber qué le falta: contestaría con total seguridad que un
 * producto no existe.
 */
const CONSIGNA = [
  'Transcribí a texto TODO el contenido de este archivo, tal como está.',
  '',
  'Reglas:',
  '- No resumas, no acortes y no saltees nada. Si es una lista de precios, ' +
    'tienen que estar todos los productos con todos sus precios.',
  '- No agregues nada que no esté en el archivo: ni aclaraciones, ni ' +
    'comentarios, ni conclusiones tuyas.',
  '- Las tablas pasalas a texto con un renglón por fila y las columnas ' +
    'separadas por " · ".',
  '- Respetá los títulos y el orden del original.',
  '- No escribas ninguna introducción del tipo "Acá está el contenido": ' +
    'empezá directamente por el contenido.',
  '- Si el archivo no tiene nada legible, respondé exactamente: NO_LEGIBLE',
].join('\n')

export async function leerArchivo(params: {
  tenantId: string
  filename: string
  mime: string | null
  bytes: Buffer
}): Promise<Lectura> {
  const tipo = tipoDeArchivo(params.filename, params.mime)
  if (!tipo) {
    return {
      error:
        'Ese tipo de archivo no se puede leer. Se aceptan PDF, imágenes y ' +
        'archivos de texto.',
    }
  }

  // Un .txt no necesita modelo ni gasta un centavo. Es el segundo caso más
  // común después del PDF y sería absurdo mandarlo a transcribir.
  if (tipo === 'texto') {
    const texto = params.bytes.toString('utf8').trim()
    if (!texto) return { error: 'El archivo está vacío.' }
    return { texto: texto.slice(0, MAX_TEXTO) }
  }

  const cuenta = await proveedorDelNegocio(params.tenantId)
  if (!cuenta) {
    return {
      error:
        'Para leer archivos hace falta una clave de API cargada en ' +
        'Configuración → Inteligencia artificial.',
    }
  }

  const modelo = MODELO_LECTOR[cuenta.provider]!
  const inicio = Date.now()
  let texto = ''
  let uso = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let fallo: string | null = null

  try {
    const salida =
      cuenta.provider === 'anthropic'
        ? await conAnthropic(cuenta.apiKey, modelo, tipo, params)
        : await conOpenAI(cuenta.apiKey, modelo, tipo, params)
    texto = salida.texto
    uso = salida.uso
  } catch (err) {
    console.error('[lector] no se pudo leer el archivo', err)
    fallo = String(err)
  }

  /*
   * El gasto se registra igual que el de una conversación, pero sin
   * `conversation_id`: cuenta para el tope mensual de la cuenta, que es
   * justamente lo que evita que subir cuarenta PDF de golpe se lleve el
   * presupuesto de atención del mes sin que nadie se entere.
   */
  await withSystem((tx) =>
    tx.execute(sql`
      insert into ai_runs (
        tenant_id, model, input_tokens, output_tokens, cache_read_tokens,
        cost_usd, duration_ms, stop_reason, error
      ) values (
        ${params.tenantId}, ${modelo}, ${uso.inputTokens}, ${uso.outputTokens},
        ${uso.cacheReadTokens}, ${estimateCost(modelo, uso).toFixed(6)},
        ${Date.now() - inicio}, 'lectura_de_archivo', ${fallo}
      )
    `),
  )

  if (fallo) {
    return {
      error:
        fallo.includes('Timeout') || fallo.includes('aborted')
          ? 'La lectura tardó demasiado. Probá con un archivo más corto.'
          : 'No se pudo leer el archivo. Fijate que la clave de API sea ' +
            'válida y tenga saldo.',
    }
  }

  const limpio = texto.trim()
  if (!limpio || limpio === 'NO_LEGIBLE') {
    return {
      error:
        'No se encontró texto en el archivo. Si es un PDF escaneado o una ' +
        'foto borrosa, probá con una versión más nítida.',
    }
  }
  return { texto: limpio.slice(0, MAX_TEXTO) }
}

// ---------------------------------------------------------------------
// Una función por cada API
// ---------------------------------------------------------------------

type Salida = {
  texto: string
  uso: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
}

async function conAnthropic(
  apiKey: string,
  model: string,
  tipo: 'pdf' | 'imagen',
  a: { filename: string; mime: string | null; bytes: Buffer },
): Promise<Salida> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS })
  const data = a.bytes.toString('base64')

  const archivo: Anthropic.ContentBlockParam =
    tipo === 'pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
        }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeDeImagen(a.filename, a.mime) as
              | 'image/png'
              | 'image/jpeg'
              | 'image/webp'
              | 'image/gif',
            data,
          },
        }

  const res = await client.messages.create({
    model,
    max_tokens: 8_000,
    messages: [
      { role: 'user', content: [archivo, { type: 'text', text: CONSIGNA }] },
    ],
  })

  return {
    texto: res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n'),
    uso: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    },
  }
}

async function conOpenAI(
  apiKey: string,
  model: string,
  tipo: 'pdf' | 'imagen',
  a: { filename: string; mime: string | null; bytes: Buffer },
): Promise<Salida> {
  const base64 = a.bytes.toString('base64')
  const parte =
    tipo === 'pdf'
      ? {
          type: 'file',
          file: {
            // OpenAI decide el formato por el nombre, igual que Whisper.
            filename: a.filename.toLowerCase().endsWith('.pdf')
              ? a.filename
              : `${a.filename}.pdf`,
            file_data: `data:application/pdf;base64,${base64}`,
          },
        }
      : {
          type: 'image_url',
          image_url: {
            url: `data:${mimeDeImagen(a.filename, a.mime)};base64,${base64}`,
          },
        }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8_000,
      messages: [
        { role: 'user', content: [parte, { type: 'text', text: CONSIGNA }] },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    choices: { message: { content: string | null } }[]
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_tokens_details?: { cached_tokens?: number }
    }
  }

  return {
    texto: data.choices[0]?.message.content ?? '',
    uso: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      cacheReadTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  }
}

/**
 * Con qué clave se lee.
 *
 * La del negocio si cargó una, y si no la de la plataforma. Mismo criterio
 * que el agente: el cliente que trae su clave paga su consumo, y el que está
 * en un plan con IA incluida usa la nuestra.
 *
 * Un negocio configurado en 'mock' no tiene con qué leer: el simulado no
 * llama a nadie. Se dice, en vez de guardar un texto inventado que después
 * el asistente repetiría como si fuera la lista de precios.
 */
async function proveedorDelNegocio(
  tenantId: string,
): Promise<{ provider: string; apiKey: string } | null> {
  const fila = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select provider, api_key_enc from agent_configs
       where tenant_id = ${tenantId} and provider in ('anthropic', 'openai')
       order by provider
       limit 1
    `)
    return res.rows[0] as { provider: string; api_key_enc: unknown } | undefined
  })
  if (!fila) return null

  if (isSealed(fila.api_key_enc)) {
    try {
      const propia = openSecret(fila.api_key_enc as SealedValue).trim()
      if (propia) return { provider: fila.provider, apiKey: propia }
    } catch (err) {
      console.error('[lector] clave del negocio ilegible', err)
    }
  }

  const dePlataforma =
    fila.provider === 'openai'
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY
  const limpia = dePlataforma?.trim()
  return limpia ? { provider: fila.provider, apiKey: limpia } : null
}
