import 'server-only'
import type { ToolSpec } from './ai/provider'
import {
  comoSeLee,
  configAgenda,
  diaEnZona,
  horaEnZona,
  huecosLibres,
  instanteDe,
  proximoTurnoDe,
  type ConfigAgenda,
} from './agenda'
import {
  cambiarEstadoTurno,
  crearTurno,
  reagendarTurno,
} from './agenda-nucleo'

/**
 * Las herramientas de agenda del asistente.
 *
 * Están acá y no en `agent.ts` porque son la única parte del agente que
 * escribe en la agenda real de un negocio, y conviene poder leerlas juntas.
 *
 * LO QUE EL MODELO NO PUEDE HACER, por diseño:
 *
 *  - Elegir un horario que no ofrecimos. Cada `agendar` se comprueba contra
 *    los horarios de atención cargados.
 *  - Pisar otro turno. Lo impide Postgres, no este archivo.
 *  - Tocar el turno de otra persona: solo opera sobre el contacto de SU
 *    conversación, igual que el resto de las herramientas.
 *  - Agendar si el dueño no lo habilitó. Sin `ia_agenda`, estas herramientas
 *    ni siquiera se le ofrecen.
 *
 * Y una regla de redacción que importa más de lo que parece: los mensajes
 * que devuelven estas funciones los va a leer el modelo, no una persona.
 * Tienen que decirle qué pasó y qué hacer ahora, porque de eso depende lo
 * que le conteste al paciente. Un "error" a secas termina en un "no pude
 * procesar tu solicitud".
 */

const MAX_HUECOS = 6

export function toolsDeAgenda(): ToolSpec[] {
  return [
    {
      name: 'ver_horarios',
      description:
        'Consulta los horarios libres para ofrecer. Usar SIEMPRE antes de ' +
        'agendar: nunca propongas un horario que no salga de acá.',
      parameters: {
        type: 'object',
        properties: {
          preferencia: {
            type: 'string',
            description:
              'Lo que pidió la persona, con sus palabras: "el martes", ' +
              '"a la mañana", "lo antes posible". Opcional.',
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'agendar',
      description:
        'Reserva un turno. Usar solo después de que la persona haya ' +
        'confirmado uno de los horarios que le ofreciste.',
      parameters: {
        type: 'object',
        properties: {
          dia: { type: 'string', description: 'AAAA-MM-DD' },
          hora: { type: 'string', description: 'HH:MM en 24 horas' },
          motivo: {
            type: 'string',
            description: 'De qué es el turno, en pocas palabras.',
          },
        },
        required: ['dia', 'hora', 'motivo'],
        additionalProperties: false,
      },
    },
    {
      name: 'ver_turno',
      description:
        'Mira si esta persona ya tiene un turno reservado. Usar antes de ' +
        'reagendar o cancelar, y también si pregunta cuándo lo tiene.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'reagendar',
      description:
        'Mueve el turno que ya tiene a otro horario. Consultá los horarios ' +
        'libres primero, igual que para agendar.',
      parameters: {
        type: 'object',
        properties: {
          dia: { type: 'string', description: 'AAAA-MM-DD' },
          hora: { type: 'string', description: 'HH:MM en 24 horas' },
        },
        required: ['dia', 'hora'],
        additionalProperties: false,
      },
    },
    {
      name: 'cancelar_turno',
      description:
        'Cancela el turno que tiene. Solo si lo pide explícitamente.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', description: 'Por qué, en una línea.' },
        },
        additionalProperties: false,
      },
    },
  ]
}

export function esToolDeAgenda(nombre: string): boolean {
  return [
    'ver_horarios',
    'agendar',
    'ver_turno',
    'reagendar',
    'cancelar_turno',
  ].includes(nombre)
}

/**
 * El pedazo de instrucciones que le explica al modelo cómo usar la agenda.
 *
 * Se arma con la configuración real de la cuenta y no como texto fijo: los
 * horarios y las palabras clave los carga el cliente, y el modelo tiene que
 * ver los suyos.
 */
export function instruccionesDeAgenda(config: ConfigAgenda): string | null {
  if (!config.iaAgenda) return null

  const hoy = new Date()
  const partes = [
    '# AGENDAR TURNOS',
    '',
    'Podés reservar turnos vos mismo. Cómo se hace, sin saltear pasos:',
    '',
    '1. Consultá `ver_horarios` para saber qué hay libre.',
    '2. Ofrecé DOS o TRES opciones concretas, con día y hora.',
    '3. Esperá a que la persona elija.',
    '4. Recién ahí llamá a `agendar`, y confirmá con el día y la hora exactos.',
    '',
    'Nunca inventes un horario ni digas "te confirmamos después": o lo ' +
      'reservás en el momento, o derivás.',
    '',
    `Hoy es ${comoSeLee(hoy, config.zona)}, hora de la Argentina. Si te ` +
      'dicen "mañana" o "el martes", resolvelo a partir de esa fecha.',
  ]

  if (config.palabrasClave.length) {
    partes.push(
      '',
      'Ofrecé turno sin que te lo pidan cuando aparezca algo de esto: ' +
        config.palabrasClave.join(', ') + '.',
    )
  }

  return partes.join('\n')
}

type Ctx = {
  tenantId: string
  conversationId: string
  contactId: string | null
}

/**
 * Ejecuta una herramienta de agenda.
 *
 * Devuelve texto y no un objeto: es lo que vuelve al modelo como resultado.
 */
export async function ejecutarToolDeAgenda(
  ctx: Ctx,
  nombre: string,
  input: Record<string, unknown>,
): Promise<string> {
  const config = await configAgenda(ctx.tenantId)
  if (!config.iaAgenda) {
    return 'La agenda automática está apagada en esta cuenta. Derivá a una persona.'
  }

  switch (nombre) {
    case 'ver_horarios': {
      const huecos = await huecosLibres({
        tenantId: ctx.tenantId,
        config,
        cuantos: MAX_HUECOS,
      })
      if (!huecos.length) {
        return (
          'No hay horarios libres en los próximos ' +
          `${config.horizonteDias} días. Decile que en este momento no hay ` +
          'disponibilidad y derivá a una persona.'
        )
      }
      const lista = huecos
        .map((h) => `- ${comoSeLee(h, config.zona)}  (dia=${diaEnZona(h, config.zona)} hora=${horaEnZona(h, config.zona)})`)
        .join('\n')
      return (
        `Horarios libres:\n${lista}\n\n` +
        'Ofrecé dos o tres de estos, con las palabras de siempre. Para ' +
        'agendar, usá los valores de `dia` y `hora` tal cual figuran acá.'
      )
    }

    case 'agendar': {
      if (!ctx.contactId) {
        return 'Esta conversación no tiene un contacto asociado: no se puede agendar. Derivá.'
      }
      const inicia = instanteDe(String(input.dia ?? ''), String(input.hora ?? ''), config.zona)
      if (!inicia) {
        return 'Ese día u hora no son válidos. Volvé a consultar `ver_horarios` y usá los valores tal cual vienen.'
      }
      const termina = new Date(inicia.getTime() + config.duracionIaMin * 60_000)
      const motivo = String(input.motivo ?? '').trim() || 'Turno'

      const res = await crearTurno({
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        titulo: motivo.slice(0, 120),
        tipo: null,
        notas: null,
        inicia,
        termina,
        porIa: true,
        validarHorario: true,
      })
      if (!res.ok) {
        return `No se pudo agendar: ${res.error} Consultá \`ver_horarios\` de nuevo y ofrecé otro horario.`
      }
      return (
        `Turno confirmado para el ${comoSeLee(inicia, config.zona)}. ` +
        'Decíselo con esas mismas palabras, día y hora incluidos.'
      )
    }

    case 'ver_turno': {
      if (!ctx.contactId) return 'Esta conversación no tiene contacto asociado.'
      const t = await proximoTurnoDe(ctx.tenantId, ctx.contactId)
      if (!t) return 'No tiene ningún turno reservado.'
      return (
        `Tiene un turno el ${comoSeLee(new Date(t.inicia), config.zona)}` +
        `${t.titulo ? ` (${t.titulo})` : ''}.`
      )
    }

    case 'reagendar': {
      if (!ctx.contactId) return 'Esta conversación no tiene contacto asociado.'
      const t = await proximoTurnoDe(ctx.tenantId, ctx.contactId)
      if (!t) return 'No tiene ningún turno para mover. Si quiere uno nuevo, usá `agendar`.'

      const inicia = instanteDe(String(input.dia ?? ''), String(input.hora ?? ''), config.zona)
      if (!inicia) {
        return 'Ese día u hora no son válidos. Consultá `ver_horarios` y usá los valores tal cual vienen.'
      }
      // Se conserva cuánto duraba: si era una visita de una hora, sigue
      // siendo de una hora aunque la IA agende de a treinta minutos.
      const duracion = new Date(t.termina).getTime() - new Date(t.inicia).getTime()
      const res = await reagendarTurno({
        tenantId: ctx.tenantId,
        id: t.id,
        inicia,
        termina: new Date(inicia.getTime() + duracion),
        porIa: true,
        validarHorario: true,
      })
      if (!res.ok) {
        return `No se pudo mover: ${res.error} Consultá \`ver_horarios\` y ofrecé otro horario.`
      }
      return (
        `Turno movido al ${comoSeLee(inicia, config.zona)}. ` +
        'Confirmáselo con el día y la hora.'
      )
    }

    case 'cancelar_turno': {
      if (!ctx.contactId) return 'Esta conversación no tiene contacto asociado.'
      const t = await proximoTurnoDe(ctx.tenantId, ctx.contactId)
      if (!t) return 'No tiene ningún turno para cancelar.'
      const res = await cambiarEstadoTurno({
        tenantId: ctx.tenantId,
        id: t.id,
        estado: 'cancelada',
      })
      if (!res.ok) return `No se pudo cancelar: ${res.error}`
      return (
        `Turno del ${comoSeLee(new Date(t.inicia), config.zona)} cancelado. ` +
        'Confirmáselo y ofrecele reprogramar si quiere.'
      )
    }
  }

  return 'Herramienta desconocida.'
}
