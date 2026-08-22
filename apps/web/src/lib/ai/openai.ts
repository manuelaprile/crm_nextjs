/**
 * Proveedor OpenAI (Chat Completions con function calling).
 *
 * Se usa `fetch` directo contra la API en vez del SDK: son dos endpoints y el
 * SDK agrega una dependencia grande y un acoplamiento de versión a cambio de
 * nada. Mismo criterio que la guía de los 7 prompts para el cliente HTTP.
 */
import 'server-only'
import type {
  AIProvider,
  ChatMessage,
  CompletionInput,
  CompletionResult,
  ToolCall,
} from './provider'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
  tool_call_id?: string
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai'

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: input.system },
      ...input.messages.map(toOpenAI),
    ]

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: input.maxTokens ?? 1024,
        messages,
        tools: input.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      // El 401 es el error que más se ve al configurar: vale distinguirlo
      // para poder mostrarle al cliente "la clave es inválida" y no un 401 pelado.
      if (res.status === 401) {
        throw new Error('La clave de API de OpenAI es inválida o fue revocada.')
      }
      if (res.status === 429) {
        throw new Error('OpenAI rechazó la consulta por límite de uso o saldo.')
      }
      throw new Error(`OpenAI respondió ${res.status}: ${detalle.slice(0, 300)}`)
    }

    const data = (await res.json()) as {
      choices: {
        message: {
          content: string | null
          tool_calls?: {
            id: string
            function: { name: string; arguments: string }
          }[]
        }
        finish_reason: string
      }[]
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
      }
    }

    const choice = data.choices[0]
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      // Los argumentos vienen como string JSON. Si el modelo manda algo mal
      // formado, se trata como objeto vacío y la herramienta rechaza sola —
      // mejor que romper el turno entero.
      input: safeParse(tc.function.arguments),
    }))

    return {
      text: choice?.message.content?.trim() ?? '',
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        cacheReadTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      stopReason: choice?.finish_reason ?? 'stop',
    }
  }
}

function toOpenAI(m: ChatMessage): OpenAIMessage {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  }
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content || null,
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            })),
          }
        : {}),
    }
  }
  return { role: 'user', content: m.content }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Chequeo rápido de credencial, para el botón "Probar" del panel. */
export async function probarClaveOpenAI(
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'La clave es inválida o fue revocada.' }
    return { ok: false, error: `OpenAI respondió ${res.status}.` }
  } catch {
    return { ok: false, error: 'No se pudo contactar a OpenAI.' }
  }
}
