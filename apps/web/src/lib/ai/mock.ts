/**
 * Proveedor de IA SIMULADO. No llama a ninguna API ni cuesta un centavo.
 *
 * Para qué sirve: probar el circuito completo —mensaje entra, el agente
 * clasifica, mueve la etapa, deja la nota y deriva— sin cuenta de OpenAI,
 * sin saldo y sin internet.
 *
 * Qué NO prueba: la calidad de las respuestas del modelo real. Este simulador
 * sigue un guion fijo. Sirve para verificar que la plomería funciona: que las
 * herramientas se ejecutan, que la etapa cambia, que el handoff apaga la IA y
 * que los mensajes se guardan y se muestran.
 *
 * Sí respeta el contrato entero de `AIProvider`, así que el agente no sabe que
 * está hablando con un simulador: ejercita exactamente el mismo código.
 */
import 'server-only'
import type {
  AIProvider,
  CompletionInput,
  CompletionResult,
  ToolCall,
} from './provider'

/**
 * Guion. Cada turno del paciente avanza un paso.
 *
 * Está pensado para que en 4 mensajes se vea todo: las preguntas de
 * calificación, la carga de datos, el cambio de etapa y la derivación.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock'
  readonly model = 'simulado'

  async complete(input: CompletionInput): Promise<CompletionResult> {
    // Latencia falsa: sin esto la respuesta aparece antes que el mensaje del
    // paciente y la bandeja se ve rara al probar.
    await new Promise((r) => setTimeout(r, 400))

    // Si lo último que llegó son resultados de herramientas, ya hicimos el
    // paso de clasificar: toca cerrar y derivar. Un modelo real hace lo mismo
    // —lee el resultado y sigue—; sin esto el simulador vuelve a pedir las
    // mismas herramientas en cada vuelta del loop.
    const ultimoRol = input.messages[input.messages.length - 1]?.role
    if (ultimoRol === 'tool') {
      return {
        text:
          'Listo, ya le paso tu consulta a la secretaria. ' +
          'Te responde a la brevedad en este mismo chat.',
        toolCalls: [
          {
            id: 'mock_handoff',
            name: 'handoff',
            input: { reason: 'Calificación completa (modo prueba)' },
          },
        ],
        usage: { inputTokens: 900, outputTokens: 40, cacheReadTokens: 0 },
        stopReason: 'tool_use',
      }
    }

    const delPaciente = input.messages.filter((m) => m.role === 'user')
    const turno = delPaciente.length
    const ultimo =
      typeof delPaciente[delPaciente.length - 1]?.content === 'string'
        ? (delPaciente[delPaciente.length - 1]!.content as string)
        : ''
    const todo = delPaciente
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join(' ')

    const usage = { inputTokens: 850, outputTokens: 60, cacheReadTokens: 0 }

    // ---- Turno 1: saludo y motivo ----
    if (turno <= 1) {
      return {
        text:
          '¡Hola! Gracias por escribir al consultorio. ' +
          'Para poder ayudarte mejor, ¿me contás por qué motivo consultás?',
        toolCalls: [],
        usage,
        stopReason: 'end_turn',
      }
    }

    // ---- Turno 2: zona ----
    if (turno === 2) {
      return {
        text: 'Perfecto. ¿De qué ciudad o zona sos?',
        toolCalls: [],
        usage,
        stopReason: 'end_turn',
      }
    }

    // ---- Turno 3: cobertura ----
    if (turno === 3) {
      return {
        text: '¿Tenés obra social o prepaga, o sería particular?',
        toolCalls: [],
        usage,
        stopReason: 'end_turn',
      }
    }

    // ---- Turno 4: clasificar y cargar ----
    if (turno === 4) {
      const etapa = clasificar(todo)
      const zona = detectarZona(todo)
      const calls: ToolCall[] = [
        {
          id: 'mock_info',
          name: 'set_contact_info',
          input: zona ? { city: zona } : {},
        },
        {
          id: 'mock_stage',
          name: 'set_stage',
          input: {
            stage: etapa,
            reason: `Simulado: clasificado como "${etapa}" por el guion de prueba`,
          },
        },
        {
          id: 'mock_note',
          name: 'add_note',
          input: {
            body:
              'Consulta tomada por el asistente (modo prueba). ' +
              `Motivo declarado: "${recortar(ultimo, 120)}". Falta confirmar turno.`,
          },
        },
      ]
      return { text: '', toolCalls: calls, usage, stopReason: 'tool_use' }
    }

    // ---- Turno 5: cierre y derivación ----
    return {
      text:
        'Listo, ya le paso tu consulta a la secretaria. ' +
        'Te responde a la brevedad en este mismo chat.',
      toolCalls: [
        {
          id: 'mock_handoff',
          name: 'handoff',
          input: { reason: 'Calificación completa (modo prueba)' },
        },
      ],
      usage,
      stopReason: 'tool_use',
    }
  }
}

/** Clasificación por palabras sueltas. Alcanza para la demostración. */
function clasificar(texto: string): string {
  const t = normalizar(texto)
  if (/\bme opere|ya me opere|operado|post ?operatorio\b/.test(t)) return 'operado'
  if (/\bfui al consultorio|ya fui|estuve en el consultorio|consulte con el doctor\b/.test(t))
    return 'consultorio'
  if (/\bquiero operarme|operarme|turno|fecha|segunda opinion|estudios\b/.test(t))
    return 'interesado'
  return 'consulta'
}

const ZONAS = [
  'Córdoba', 'Villa Carlos Paz', 'Río Cuarto', 'Alta Gracia', 'Rosario',
  'Santa Fe', 'Buenos Aires', 'La Plata', 'Mendoza', 'Salta',
]

function detectarZona(texto: string): string | null {
  const t = normalizar(texto)
  for (const z of ZONAS) {
    if (t.includes(normalizar(z))) return z
  }
  return null
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function recortar(s: string, n: number): string {
  const t = s.trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
