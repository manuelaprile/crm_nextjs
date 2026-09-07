import 'server-only'
import type { ToolSpec } from './ai/provider'
import {
  comoSeLee,
  comoSeLeeDia,
  configAgenda,
  diaEnZona,
  estaLibre,
  horaEnZona,
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

export function toolsDeAgenda(): ToolSpec[] {
  return [
    {
      name: 'esta_libre',
      description:
        'Comprueba si se puede agendar UN día y hora puntuales. Solo mira el ' +
        'calendario del negocio: si ese día se atiende, si no es sobre la ' +
        'hora y si no ya pasó. NO mira si hay otra visita a esa hora, porque ' +
        'eso no impide nada. Usálo si dudas de un día; si te dieron uno ' +
        'válido, agendá directo.',
      parameters: {
        type: 'object',
        properties: {
          dia: { type: 'string', description: 'AAAA-MM-DD, del calendario.' },
          hora: { type: 'string', description: 'HH:MM en 24 horas' },
        },
        required: ['dia', 'hora'],
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
          /*
            Qué clase de encuentro es. Texto libre y no una lista fija:
            para un consultorio es "consulta", para una inmobiliaria "visita
            a la propiedad". Una lista cerrada acá sería un rubro escrito a
            mano en el código (ver CLAUDE.md).
          */
          tipo: {
            type: 'string',
            description:
              'Qué clase de encuentro es, en una o dos palabras: visita, ' +
              'llamada, reunión, consulta. Usá la palabra con la que se ' +
              'habló en la conversación.',
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
    'esta_libre',
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
    'Podés reservar turnos vos mismo.',
    '',
    'NO OFREZCAS HORARIOS. No tenes que proponer opciones ni decir qué hay ' +
      'libre: preguntále QUÉ DÍA Y A QUÉ HORA le queda cómodo, y agendá lo ' +
      'que te diga. La disponibilidad la termina acomodando un asesor, así ' +
      'que no hay una lista de huecos que respetar.',
    '',
    '1. Preguntá qué día le viene bien. Una sola pregunta.',
    '2. Cuando te lo diga, preguntá a qué hora.',
    '3. Con el día y la hora, llamá a `agendar` y confirmá repitiendo los dos.',
    '',
    'Que a esa hora ya haya otra visita NO es un problema y no hace falta ' +
      'que lo mires: se acomoda después.',
    '',
    'Lo único que puede fallar es el calendario del negocio: un día que no ' +
      'se atiende, algo demasiado sobre la hora, o una fecha que ya pasó. Si ' +
      '`agendar` te rechaza por eso, decile el motivo con sus palabras y ' +
      'pedile otro día. Si dudás antes de agendar, consultá `esta_libre`.',
    '',
    'Nunca digas "te confirmamos después": o lo reservás en el momento, o ' +
      'derivás.',
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
    `- "la semana que viene" = del ${lunes} al ${domingo}.`,
    '',
    'Si un día que nombraste no coincide con la tabla, corregite y volvé a ' +
      'mirar. Confirmar un turno el día equivocado es peor que no agendarlo.',
  ]

  if (config.palabrasClave.length) {
    /*
     * Los temas NO son un filtro de texto: no hay ninguna comparación contra
     * el mensaje en todo el sistema. Entran acá como prosa y el modelo los
     * lee como temas, que es lo que hace que "cuándo puedo pasar a verla"
     * caiga adentro sin estar escrito en la lista.
     *
     * Lo segundo —consultar en el mismo turno— salió de probarlo con un
     * modelo real: entendía perfecto el tema y contestaba "¿para cuándo te
     * gustaría?" en vez de mirar la agenda. No está mal, pero es un mensaje
     * perdido: la agenda la va a tener que mirar igual, y mientras tanto la
     * persona espera.
     */
    partes.push(
      '',
      'Ofrecé turno sin que te lo pidan cuando la consulta sea sobre algo ' +
        'de esto: ' + config.palabrasClave.join(', ') + '.',
      '',
      'No hace falta que usen esas palabras exactas ni en esa forma: lo que ' +
        'cuenta es el tema. "Me gustaría visitarla", "¿cuándo puedo pasar?" ' +
        'y "¿podemos juntarnos?" son todas lo mismo.',
      '',
      'Cuando pase, preguntále qué día le queda cómodo. Si ya te dijo el ' +
        'día, preguntá la hora. Con los dos, agendá.',
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
/**
 * Ejecuta una herramienta de agenda.
 *
 * Devuelve también si ESTA llamada dejó un turno reservado, porque cuando
 * eso pasa la IA se retira y sigue una persona. El dato sale de una marca
 * que pone la propia rama de `agendar`, y no de mirar el texto que se le
 * devuelve al modelo: ese texto se reescribe cada dos por tres y la
 * derivación dejaría de dispararse sin que nadie se entere.
 */
export async function ejecutarToolDeAgenda(
  ctx: Ctx,
  nombre: string,
  input: Record<string, unknown>,
): Promise<{ texto: string; agendo: boolean }> {
  const marca = { agendo: false }
  const texto = await correrToolDeAgenda(ctx, nombre, input, marca)
  return { texto, agendo: marca.agendo }
}

async function correrToolDeAgenda(
  ctx: Ctx,
  nombre: string,
  input: Record<string, unknown>,
  marca: { agendo: boolean },
): Promise<string> {
  const config = await configAgenda(ctx.tenantId)
  if (!config.iaAgenda) {
    return 'La agenda automática está apagada en esta cuenta. Derivá a una persona.'
  }

  switch (nombre) {
    case 'esta_libre': {
      const dia = String(input.dia ?? '').trim()
      const hora = String(input.hora ?? '').trim()
      const inicio = instanteDe(dia, hora, config.zona)
      if (!inicio) {
        return 'Ese día u hora no son válidos. Usá AAAA-MM-DD y HH:MM, sacando el día del calendario de tus instrucciones.'
      }
      const motivo = await estaLibre({ tenantId: ctx.tenantId, config, inicio })
      const cuando = comoSeLee(inicio, config.zona)
      switch (motivo) {
        case 'libre':
          return `SÍ, el ${cuando} está libre. Podés agendarlo con dia=${dia} hora=${hora}.`
        case 'fuera-de-horario':
          return `NO, el ${cuando} queda fuera del horario de atención. Decile cuáles son los horarios y ofrecé alternativas.`
        case 'muy-pronto':
          return `NO, el ${cuando} es demasiado sobre la hora: hay que avisar con ${config.anticipacionHoras} horas de anticipación. Ofrecé algo más adelante.`
        case 'pasado':
          return `NO, el ${cuando} ya pasó. Fijate el calendario de tus instrucciones y ofrecé una fecha futura.`
      }
      return 'No se pudo comprobar ese horario.'
    }

    case 'agendar': {
      if (!ctx.contactId) {
        return 'Esta conversación no tiene un contacto asociado: no se puede agendar. Derivá.'
      }
      const inicia = instanteDe(String(input.dia ?? ''), String(input.hora ?? ''), config.zona)
      if (!inicia) {
        return 'Ese día u hora no son válidos. Usá AAAA-MM-DD y HH:MM, sacando el día del calendario de tus instrucciones.'
      }
      const termina = new Date(inicia.getTime() + config.duracionIaMin * 60_000)
      const motivo = String(input.motivo ?? '').trim() || 'Turno'

      const res = await crearTurno({
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        titulo: motivo.slice(0, 120),
        tipo: String(input.tipo ?? '').trim().slice(0, 60) || null,
        notas: null,
        inicia,
        termina,
        porIa: true,
        validarHorario: true,
      })
      if (!res.ok) {
        return `No se pudo agendar: ${res.error} Decíselo con tus palabras y pedile otro día u horario.`
      }
      marca.agendo = true
      return (
        `Turno confirmado para el ${comoSeLee(inicia, config.zona)}. ` +
        'Decíselo con esas mismas palabras, día y hora incluidos, y cerrá ' +
        'ahí: a partir de este mensaje sigue un asesor.'
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
        return 'Ese día u hora no son válidos. Usá AAAA-MM-DD y HH:MM, sacando el día del calendario de tus instrucciones.'
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
        return `No se pudo mover: ${res.error} Decíselo con tus palabras y pedile otro día u horario.`
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
