/**
 * Catálogo de modelos ofrecidos en el panel.
 *
 * Vive separado de `provider.ts` a propósito: `provider.ts` está marcado
 * `server-only` (arma llamadas con claves de API), y el formulario de
 * configuración es un componente de cliente que necesita esta lista para
 * armar el desplegable. Importar el módulo server-only desde el cliente
 * rompe la compilación.
 *
 * Regla: acá solo van datos inertes. Nada que toque una clave, la base o una
 * variable de entorno.
 */

export type ModeloInfo = { id: string; label: string; nota: string }

export const MODELOS: Record<string, ModeloInfo[]> = {
  openai: [
    {
      id: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      nota: 'El más barato de OpenAI. Alcanza de sobra para calificar y derivar.',
    },
    {
      id: 'gpt-4.1-mini',
      label: 'GPT-4.1 mini',
      nota: 'Un escalón arriba, redacta un poco mejor.',
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      nota: 'Bastante más caro. Solo si los otros se quedan cortos.',
    },
  ],
  anthropic: [
    {
      id: 'claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      nota: 'Barato y rápido. Recomendado para este uso.',
    },
    {
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      nota: 'Más caro, mejor redacción.',
    },
  ],
}

/**
 * Precios por millón de tokens, para estimar costo y aplicar el tope del plan.
 * Son aproximados y solo se usan para el control de gasto, nunca para
 * facturarle a nadie. Si cambian, se actualizan acá.
 */
export const PRICING: Record<
  string,
  { in: number; out: number; cacheRead: number }
> = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0, cacheRead: 0.1 },
  'claude-sonnet-5': { in: 3.0, out: 15.0, cacheRead: 0.3 },
  'claude-opus-5': { in: 5.0, out: 25.0, cacheRead: 0.5 },
  'gpt-4o-mini': { in: 0.15, out: 0.6, cacheRead: 0.075 },
  'gpt-4o': { in: 2.5, out: 10.0, cacheRead: 1.25 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6, cacheRead: 0.1 },
  'gpt-4.1': { in: 2.0, out: 8.0, cacheRead: 0.5 },
}

export function estimateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number },
): number {
  const p = PRICING[model] ?? { in: 1, out: 5, cacheRead: 0.1 }
  return (
    (usage.inputTokens / 1_000_000) * p.in +
    (usage.outputTokens / 1_000_000) * p.out +
    (usage.cacheReadTokens / 1_000_000) * p.cacheRead
  )
}
