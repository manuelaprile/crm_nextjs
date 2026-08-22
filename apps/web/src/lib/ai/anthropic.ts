/**
 * Proveedor Anthropic (Messages API con tool use).
 *
 * Usa el SDK oficial porque ya estaba en el proyecto y porque el manejo de
 * bloques de contenido es bastante más prolijo con tipos que a mano.
 */
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type {
  AIProvider,
  ChatMessage,
  CompletionInput,
  CompletionResult,
  ToolCall,
} from './provider'

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: input.maxTokens ?? 1024,
        // El prompt del sistema es estable por consultorio: cacheándolo, cada
        // turno siguiente de la conversación cuesta una fracción.
        system: [
          {
            type: 'text',
            text: input.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: input.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
        messages: input.messages.map(toAnthropic),
      })
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new Error('La clave de API de Anthropic es inválida o fue revocada.')
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new Error('Anthropic rechazó la consulta por límite de uso.')
      }
      throw err
    }

    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: (b.input ?? {}) as Record<string, unknown>,
      }))

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
      stopReason: response.stop_reason ?? 'end_turn',
    }
  }
}

function toAnthropic(m: ChatMessage): Anthropic.MessageParam {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content },
      ],
    }
  }
  if (m.role === 'assistant') {
    const blocks: Anthropic.ContentBlockParam[] = []
    if (m.content) blocks.push({ type: 'text', text: m.content })
    for (const tc of m.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
    }
    return { role: 'assistant', content: blocks }
  }
  return { role: 'user', content: m.content }
}

/** Chequeo rápido de credencial, para el botón "Probar" del panel. */
export async function probarClaveAnthropic(
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new Anthropic({ apiKey })
    await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'La clave es inválida o fue revocada.' }
    }
    return { ok: false, error: 'No se pudo contactar a Anthropic.' }
  }
}
