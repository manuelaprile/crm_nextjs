/**
 * Capa de proveedor de IA.
 *
 * El agente no sabe con qué modelo está hablando. Define herramientas y manda
 * mensajes; el proveedor traduce eso al formato de cada API y devuelve
 * siempre la misma forma.
 *
 * Está así porque el cliente puede traer su propia clave (hoy de OpenAI) y
 * porque cambiar de proveedor no debe obligar a reescribir el agente. Es la
 * misma idea de `WhatsAppProvider`: aislar lo que va a cambiar.
 *
 * Para agregar un proveedor nuevo alcanza con implementar `AIProvider` y
 * sumarlo a `createProvider()`. El agente no se toca.
 */
import 'server-only'

export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type CompletionResult = {
  /** Texto para mandarle al paciente. Vacío si solo pidió herramientas. */
  text: string
  toolCalls: ToolCall[]
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
  }
  stopReason: string
}

export type CompletionInput = {
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  maxTokens?: number
}

// El catálogo de modelos y los precios viven en `models.ts`, sin `server-only`,
// porque el formulario de configuración (componente de cliente) los necesita.
export { MODELOS, PRICING, estimateCost } from './models'
export type { ModeloInfo } from './models'

export interface AIProvider {
  readonly name: string
  readonly model: string
  complete(input: CompletionInput): Promise<CompletionResult>
}

export async function createProvider(opts: {
  provider: string
  model: string
  apiKey: string
}): Promise<AIProvider> {
  switch (opts.provider) {
    case 'openai': {
      const { OpenAIProvider } = await import('./openai')
      return new OpenAIProvider(opts.apiKey, opts.model)
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./anthropic')
      return new AnthropicProvider(opts.apiKey, opts.model)
    }
    case 'mock': {
      // Red de seguridad: si la clave del cliente se queda sin saldo o falla,
      // se puede cambiar el proveedor a 'mock' y la atención sigue con un
      // guion fijo en vez de quedar muda. No cuesta nada y no llama a nadie.
      const { MockProvider } = await import('./mock')
      return new MockProvider()
    }
    default:
      throw new Error(`Proveedor de IA desconocido: ${opts.provider}`)
  }
}
