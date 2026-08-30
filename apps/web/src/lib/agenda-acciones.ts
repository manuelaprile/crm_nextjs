'use server'

/**
 * La agenda desde el panel: cargar, mover, cancelar y configurar.
 *
 * Escribe a través de `agenda-nucleo`, el mismo camino que usa el asistente.
 * Si cada uno escribiera por su lado, uno de los dos se olvidaría de mover
 * la etapa del contacto y la diferencia recién se vería en un reporte raro.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireTenant, requireAdmin } from './auth'
import { withTenant, withSystem } from './db/client'
import { configAgenda, instanteDe } from './agenda'
import {
  borrarTurno,
  cambiarEstadoTurno,
  crearTurno,
  reagendarTurno,
} from './agenda-nucleo'

const MAX_TITULO = 120
const MAX_NOTAS = 2_000

/**
 * Valida que un usuario pueda quedar a cargo de un turno.
 *
 * El id viaja en un `<select>`, o sea que es entrada del navegador: sin este
 * chequeo alguien manda el id de un usuario de otra cuenta y le aparece un
 * turno ajeno en su agenda. Va con `withTenant`, así que RLS ya recorta
 * `tenant_users` a la cuenta de la sesión.
 */
async function puedeQuedarACargo(
  session: Awaited<ReturnType<typeof requireTenant>>,
  userId: string,
): Promise<boolean> {
  const res = await withTenant(session, (tx) =>
    tx.execute(sql`
      select 1 from tenant_users tu
        join users u on u.id = tu.user_id
       where tu.user_id = ${userId}
         and u.is_superadmin = false and u.disabled_at is null
    `),
  )
  return res.rows.length > 0
}

function volver(tipo: 'ok' | 'error', msg: string, dia?: string): never {
  const sp = new URLSearchParams({ r: tipo, m: msg.slice(0, 200) })
  if (dia) sp.set('d', dia)
  redirect(`/agenda?${sp.toString()}`)
}

/**
 * Vuelve a la conversación desde la que se agendó, si vino de una.
 *
 * El destino NO se toma del formulario. Llega un id de conversación y la
 * ruta se arma acá: un campo con la URL de destino es una redirección
 * abierta —alguien manda un formulario con `volverA=https://otrositio` y el
 * panel lo manda ahí, con la confianza que da venir del CRM—. Con solo el
 * id, lo peor que puede pasar es caer en una conversación que no existe.
 */
function volverAlChat(id: string, tipo: 'ok' | 'error', msg: string): never {
  const sp = new URLSearchParams({ r: tipo, m: msg.slice(0, 200) })
  redirect(`/bandeja/${encodeURIComponent(id)}?${sp.toString()}`)
}

/**
 * Lee día, hora de inicio y hora de fin de un formulario.
 *
 * El fin puede venir como hora ("11:30") o vacío. Vacío no es un error: se
 * usa la duración por defecto de la cuenta, que es lo que alguien espera
 * cuando carga un turno rápido y no piensa en cuánto dura.
 */
async function horarioDelForm(
  formData: FormData,
  tenantId: string,
): Promise<{ inicia: Date; termina: Date } | { error: string }> {
  const config = await configAgenda(tenantId)
  const dia = String(formData.get('dia') ?? '').trim()
  const desde = String(formData.get('desde') ?? '').trim()
  const hasta = String(formData.get('hasta') ?? '').trim()

  const inicia = instanteDe(dia, desde, config.zona)
  if (!inicia) return { error: 'Revisá la fecha y la hora de inicio.' }

  if (!hasta) {
    return {
      inicia,
      termina: new Date(inicia.getTime() + config.duracionIaMin * 60_000),
    }
  }
  const termina = instanteDe(dia, hasta, config.zona)
  if (!termina) return { error: 'Revisá la hora de fin.' }
  if (termina <= inicia) {
    return { error: 'El turno tiene que terminar después de empezar.' }
  }
  return { inicia, termina }
}

/**
 * Carga un turno a mano.
 *
 * La usan dos pantallas: la agenda y el chat. Cuando viene del chat, el
 * campo `conversationId` trae de dónde salió, y ahí es donde vuelve: sacar a
 * alguien de la conversación que está atendiendo para mostrarle la agenda es
 * hacerle perder el hilo justo cuando está hablando con una persona.
 */
export async function guardarTurno(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const desdeChat = String(formData.get('conversationId') ?? '').trim() || null
  // El tipo va en la variable y no solo en la flecha: TypeScript necesita la
  // anotación explícita para saber que llamarla corta el flujo, y sin eso no
  // estrecha los tipos de abajo.
  const fallar: (msg: string) => never = (msg) =>
    desdeChat ? volverAlChat(desdeChat, 'error', msg) : volver('error', msg)

  const titulo = String(formData.get('titulo') ?? '').trim()
  if (!titulo) fallar('Poné de qué es el turno.')
  if (titulo.length > MAX_TITULO) {
    fallar(`El título no puede pasar de ${MAX_TITULO} caracteres.`)
  }

  const horario = await horarioDelForm(formData, session.tenantId)
  if ('error' in horario) fallar(horario.error)

  const contactId = String(formData.get('contactId') ?? '').trim() || null
  // Que el contacto sea DE ESTA CUENTA. El id viaja en un campo oculto del
  // formulario, así que es entrada del navegador como cualquier otra.
  if (contactId) {
    const existe = await withTenant(session, (tx) =>
      tx.execute(sql`select 1 from contacts where id = ${contactId}`),
    )
    if (!existe.rows.length) fallar('Ese contacto no existe.')
  }
  // La conversación también: viene de un campo oculto.
  if (desdeChat) {
    const existe = await withTenant(session, (tx) =>
      tx.execute(sql`select 1 from conversations where id = ${desdeChat}`),
    )
    if (!existe.rows.length) volver('error', 'Esa conversación no existe.')
  }

  /**
   * Quién queda a cargo.
   *
   * Un operador no elige: el turno es suyo. Podría cargar uno para un
   * contacto que no sigue —desde el chat se puede abrir cualquiera— y
   * dejárselo a otro sin querer.
   *
   * Un dueño o un admin sí eligen, y dejar el campo vacío NO es "sin
   * responsable": es "el que ya viene siguiendo a este contacto", que es lo
   * que hace `crearTurno` cuando no se le dice nada. Por eso `undefined` y
   * no `null`.
   */
  let asignadoA: string | null | undefined
  if (session.role === 'agent') {
    asignadoA = session.userId
  } else {
    const elegido = String(formData.get('asignadoA') ?? '').trim()
    if (elegido) {
      if (!(await puedeQuedarACargo(session, elegido))) {
        fallar('Esa persona no puede quedar a cargo de un turno.')
      }
      asignadoA = elegido
    }
  }

  const res = await crearTurno({
    tenantId: session.tenantId,
    contactId,
    conversationId: desdeChat,
    titulo,
    tipo: String(formData.get('tipo') ?? '').trim() || null,
    notas: String(formData.get('notas') ?? '').trim().slice(0, MAX_NOTAS) || null,
    inicia: horario.inicia,
    termina: horario.termina,
    userId: session.userId,
    asignadoA,
    // A una persona no se le validan los horarios de atención: si carga algo
    // un sábado, sabe lo que hace.
    validarHorario: false,
  })
  if (!res.ok) fallar(res.error)

  revalidatePath('/agenda')
  const aviso = res.etapaMovida
    ? `Turno agendado. El contacto pasó a «${res.etapaMovida}».`
    : 'Turno agendado.'
  if (desdeChat) {
    revalidatePath(`/bandeja/${desdeChat}`)
    volverAlChat(desdeChat, 'ok', aviso)
  }
  volver('ok', aviso)
}

/** Mueve un turno a otro horario. */
export async function moverTurno(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) volver('error', 'Falta el turno.')

  const horario = await horarioDelForm(formData, session.tenantId)
  if ('error' in horario) volver('error', horario.error)

  const res = await reagendarTurno({
    tenantId: session.tenantId,
    id,
    inicia: horario.inicia,
    termina: horario.termina,
    userId: session.userId,
    validarHorario: false,
  })
  if (!res.ok) volver('error', res.error)

  revalidatePath('/agenda')
  volver('ok', 'Turno movido.')
}

/**
 * Cambiar a quién le toca un turno.
 *
 * Solo owner/admin, igual que derivar una conversación: si un operador
 * pudiera reasignar, estaría sacándose trabajo de encima o poniéndoselo a
 * otro sin que nadie lo decida.
 *
 * No redirige cuando sale bien: la URL de la agenda lleva la vista, el día y
 * el filtro, y reescribirla para mostrar un cartel te saca de donde estabas.
 */
export async function asignarTurno(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '').trim()
  const userId = String(formData.get('userId') ?? '').trim() || null
  if (!id) volver('error', 'Falta el turno.')

  if (userId && !(await puedeQuedarACargo(session, userId))) {
    volver('error', 'Esa persona no puede quedar a cargo de un turno.')
  }

  const hecho = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      update appointments set assigned_user_id = ${userId}
       where id = ${id}
       returning id
    `)
    if (!res.rows.length) return false
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
      values (${session.tenantId}, ${session.userId}, 'agenda.asignado',
              'appointment', ${id}, ${JSON.stringify({ a: userId })}::jsonb)
    `)
    return true
  })
  if (!hecho) volver('error', 'Ese turno no existe.')

  revalidatePath('/agenda')
}

const ESTADOS = ['programada', 'cumplida', 'ausente', 'cancelada'] as const

/** Cancelar, marcar que vino, o que no vino. */
export async function estadoDeTurno(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const id = String(formData.get('id') ?? '').trim()
  const estado = String(formData.get('estado') ?? '')
  if (!id) volver('error', 'Falta el turno.')
  if (!(ESTADOS as readonly string[]).includes(estado)) {
    volver('error', 'Estado desconocido.')
  }

  const res = await cambiarEstadoTurno({
    tenantId: session.tenantId,
    id,
    estado: estado as (typeof ESTADOS)[number],
  })
  if (!res.ok) volver('error', res.error)

  revalidatePath('/agenda')
  const dicho: Record<string, string> = {
    programada: 'Turno reactivado.',
    cumplida: 'Marcado como cumplido.',
    ausente: 'Marcado como ausente.',
    cancelada: 'Turno cancelado. Queda en el historial.',
  }
  volver('ok', dicho[estado] ?? 'Listo.')
}

/**
 * Borra un turno de verdad.
 *
 * Distinto de cancelar: esto es para el turno cargado por error. Cancelar
 * guarda que se canceló, que es un dato del negocio; borrar no deja nada.
 */
export async function eliminarTurno(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) volver('error', 'Falta el turno.')

  const fue = await borrarTurno(session.tenantId, id)
  if (!fue) volver('error', 'Ese turno no existe.')

  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId}, 'agenda.borrado',
              'appointment', ${id})
    `),
  )
  revalidatePath('/agenda')
  volver('ok', 'Turno eliminado.')
}

// ---------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------

const DIAS = ['0', '1', '2', '3', '4', '5', '6']

/**
 * Guarda los horarios de atención y el resto de la configuración.
 *
 * Los horarios llegan como un par de campos por día. Un día sin horas es un
 * día cerrado, y eso NO es un error: hay negocios que no abren los sábados.
 */
export async function guardarConfigAgenda(formData: FormData): Promise<void> {
  const session = await requireAdmin()

  const horarios: Record<string, [string, string][]> = {}
  for (const d of DIAS) {
    const abre = String(formData.get(`abre_${d}`) ?? '').trim()
    const cierra = String(formData.get(`cierra_${d}`) ?? '').trim()
    if (!abre || !cierra) continue
    if (!/^\d{1,2}:\d{2}$/.test(abre) || !/^\d{1,2}:\d{2}$/.test(cierra)) {
      redirect(`/configuracion/agenda?r=error&m=${encodeURIComponent('Revisá los horarios: tienen que ser como 09:00.')}`)
    }
    if (cierra <= abre) {
      redirect(`/configuracion/agenda?r=error&m=${encodeURIComponent('Un día no puede cerrar antes de abrir.')}`)
    }
    horarios[d] = [[abre, cierra]]
  }

  const duracion = Math.min(480, Math.max(5, Number(formData.get('duracion')) || 30))
  const anticipacion = Math.min(168, Math.max(0, Number(formData.get('anticipacion')) || 0))
  const horizonte = Math.min(365, Math.max(1, Number(formData.get('horizonte')) || 30))
  const iaAgenda = String(formData.get('iaAgenda') ?? '') === 'si'
  const etapa = String(formData.get('etapa') ?? '').trim() || null

  // Una por línea, igual que las palabras de derivación que ya se cargan así.
  //
  // Van con `sql.param()` y NO con `${claves}::text[]`: Drizzle liga un array
  // de JS como una TUPLA, y Postgres contesta "cannot cast type record to
  // text[]". Es el mismo error que ya apareció con los adjuntos.
  const claves = String(formData.get('palabras') ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50)

  if (etapa) {
    const ok = await withTenant(session, (tx) =>
      tx.execute(sql`select 1 from stages where id = ${etapa}`),
    )
    if (!ok.rows.length) {
      redirect(`/configuracion/agenda?r=error&m=${encodeURIComponent('Esa etapa no existe.')}`)
    }
  }

  await withTenant(session, (tx) =>
    tx.execute(sql`
      insert into agenda_config
        (tenant_id, ia_agenda, duracion_ia_min, anticipacion_horas,
         horizonte_dias, horarios, etapa_al_agendar, palabras_clave)
      values (${session.tenantId}, ${iaAgenda}, ${duracion}, ${anticipacion},
              ${horizonte}, ${JSON.stringify(horarios)}::jsonb, ${etapa},
              ${sql.param(claves)})
      on conflict (tenant_id) do update set
        ia_agenda = excluded.ia_agenda,
        duracion_ia_min = excluded.duracion_ia_min,
        anticipacion_horas = excluded.anticipacion_horas,
        horizonte_dias = excluded.horizonte_dias,
        horarios = excluded.horarios,
        etapa_al_agendar = excluded.etapa_al_agendar,
        palabras_clave = excluded.palabras_clave
    `),
  )

  revalidatePath('/configuracion/agenda')
  redirect(`/configuracion/agenda?r=ok&m=${encodeURIComponent('Guardado.')}`)
}
