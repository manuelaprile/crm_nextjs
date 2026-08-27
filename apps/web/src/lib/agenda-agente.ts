import 'server-only'
import type { ToolSpec } from './ai/provider'
import {
  comoSeLee,
  configAgenda,
  diaEnZona,
  horaEnZona,
  huecosLibres,
  instanteDe,
  partesEnZona,
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
          desde_dia: {
            type: 'string',
            description:
              'AAAA-MM-DD. El primer día a partir del cual buscar. Sacalo ' +
              'del CALENDARIO de tus instrucciones, no lo calcules. Si te ' +
              'dicen "la semana que viene", poné el lunes de esa semana. ' +
              'Omitilo para buscar lo antes posible.',
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

/** Cuántos días del calendario se le pasan al modelo. */
const DIAS_DE_CALENDARIO = 16

/**
 * El calendario de los próximos días, ya resuelto.
 *
 * Existe porque los modelos calculan mal las fechas y lo hacen con total
 * seguridad. Pasó exactamente esto: le pidieron turno "para la semana que
 * viene" y ofreció el viernes 28, que era el día siguiente; y cuando le
 * dijeron que estaba mal, corrigió a "jueves 2" cuando el jueves era 3.
 *
 * Ninguna instrucción arregla eso, porque el modelo no cree estar
 * calculando: cree que sabe qué día es. La solución es no pedirle que
 * calcule. Con la tabla armada, pasa de hacer aritmética a buscar una fila.
 */
function calendario(hoy: Date, zona: string): string {
  const filas: string[] = []
  for (let i = 0; i < DIAS_DE_CALENDARIO; i++) {
    const d = new Date(hoy.getTime() + i * 24 * 3_600_000)
    const dia = diaEnZona(d, zona)
    const nombre = new Intl.DateTimeFormat('es-AR', {
      timeZone: zona,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(d)
    const marca = i === 0 ? '  <- HOY' : i === 1 ? '  <- mañana' : ''
    filas.push(`${dia}  ${nombre}${marca}`)
  }
  return filas.join('\n')
}

/** El lunes de la semana siguiente, en la zona del negocio. */
function lunesQueViene(hoy: Date, zona: string): string {
  const { diaSemana } = partesEnZona(hoy, zona)
  // Domingo cuenta como final de semana: para alguien que escribe un domingo,
  // "la semana que viene" es el lunes de mañana, no el de dentro de ocho días.
  const faltan = diaSemana === 0 ? 1 : 8 - diaSemana
  return diaEnZona(new Date(hoy.getTime() + faltan * 24 * 3_600_000), zona)
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
  const lunes = lunesQueViene(hoy, config.zona)
  const domingo = diaEnZona(
    new Date(
      (instanteDe(lunes, '12:00', config.zona)?.getTime() ?? hoy.getTime()) +
        6 * 24 * 3_600_000,
    ),
    config.zona,
  )

  const partes = [
    '# AGENDAR TURNOS',
    '',
    'Podés reservar turnos vos mismo. Cómo se hace, sin saltear pasos:',
    '',
    '1. Consultá `ver_horarios` para saber qué hay libre. Si te pidieron un ' +
      'día o una semana en particular, pasale `desde_dia`.',
    '2. Ofrecé DOS o TRES opciones concretas, copiando el día y la hora tal ' +
      'como te los devolvió la herramienta.',
    '3. Esperá a que la persona elija.',
    '4. Recién ahí llamá a `agendar`, y confirmá con el día y la hora exactos.',
    '',
    'Nunca inventes un horario ni digas "te confirmamos después": o lo ' +
      'reservás en el momento, o derivás.',
    '',
    '## CALENDARIO',
    '',
    'NO calcules fechas ni días de la semana: buscalos en esta tabla. Es la ' +
      'única fuente correcta, y tu propia cuenta va a estar mal.',
    '',
    '```',
    calendario(hoy, config.zona),
    '```',
    '',
    `- "hoy" = ${diaEnZona(hoy, config.zona)}`,
    `- "mañana" = ${diaEnZona(new Date(hoy.getTime() + 24 * 3_600_000), config.zona)}`,
    `- "esta semana" = hasta el ${diaEnZona(new Date((instanteDe(lunes, '12:00', config.zona)?.getTime() ?? hoy.getTime()) - 24 * 3_600_000), config.zona)}`,
    `- "la semana que viene" = del ${lunes} al ${domingo}. Para eso, ` +
      `\`ver_horarios\` con desde_dia=${lunes}.`,
    '',
    'Si un día que nombraste no coincide con la tabla, corregite y volvé a ' +
      'mirar. Confirmar un turno el día equivocado es peor que no agendarlo.',
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
      // El parámetro se USA. En la primera versión estaba declarado y no se
      // leía: el modelo pedía "la semana que viene", recibía los primeros
      // huecos —que eran del día siguiente— y los presentaba como si fueran
      // de la semana que viene. Un parámetro que se acepta y se ignora es
      // peor que no tenerlo: el modelo cree que lo tuvieron en cuenta.
      const pedido = String(input.desde_dia ?? '').trim()
      const desde = pedido ? instanteDe(pedido, '00:00', config.zona) : null
      if (pedido && !desde) {
        return 'Ese día no es válido. Usá AAAA-MM-DD, sacándolo del calendario de tus instrucciones.'
      }

      const huecos = await huecosLibres({
        tenantId: ctx.tenantId,
        config,
        cuantos: MAX_HUECOS,
        desde: desde ?? undefined,
      })
      if (!huecos.length) {
        // Si buscó a partir de una fecha, puede que más adelante haya y
        // antes también: decirle las dos cosas evita que corte la
        // conversación con un "no hay nada".
        const alternativa = desde
          ? ' a partir de ese día. Probá `ver_horarios` sin `desde_dia` para ver lo primero que haya'
          : ` en los próximos ${config.horizonteDias} días`
        return (
          `No hay horarios libres${alternativa}. Si tampoco hay, decile que ` +
          'en este momento no hay disponibilidad y derivá a una persona.'
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
