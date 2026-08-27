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

function volver(tipo: 'ok' | 'error', msg: string, dia?: string): never {
  const sp = new URLSearchParams({ r: tipo, m: msg.slice(0, 200) })
  if (dia) sp.set('d', dia)
  redirect(`/agenda?${sp.toString()}`)
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

/** Carga un turno a mano. */
export async function guardarTurno(formData: FormData): Promise<void> {
  const session = await requireTenant()
  const titulo = String(formData.get('titulo') ?? '').trim()
  if (!titulo) volver('error', 'Poné de qué es el turno.')
  if (titulo.length > MAX_TITULO) {
    volver('error', `El título no puede pasar de ${MAX_TITULO} caracteres.`)
  }

  const horario = await horarioDelForm(formData, session.tenantId)
  if ('error' in horario) volver('error', horario.error)

  const contactId = String(formData.get('contactId') ?? '').trim() || null
  // Que el contacto sea DE ESTA CUENTA. El id viaja en un campo oculto del
  // formulario, así que es entrada del navegador como cualquier otra.
  if (contactId) {
    const existe = await withTenant(session, (tx) =>
      tx.execute(sql`select 1 from contacts where id = ${contactId}`),
    )
    if (!existe.rows.length) volver('error', 'Ese contacto no existe.')
  }

  const res = await crearTurno({
    tenantId: session.tenantId,
    contactId,
    titulo,
    tipo: String(formData.get('tipo') ?? '').trim() || null,
    notas: String(formData.get('notas') ?? '').trim().slice(0, MAX_NOTAS) || null,
    inicia: horario.inicia,
    termina: horario.termina,
    userId: session.userId,
    // A una persona no se le validan los horarios de atención: si carga algo
    // un sábado, sabe lo que hace.
    validarHorario: false,
  })
  if (!res.ok) volver('error', res.error)

  revalidatePath('/agenda')
  volver(
    'ok',
    res.etapaMovida
      ? `Turno agendado. El contacto pasó a «${res.etapaMovida}».`
      : 'Turno agendado.',
  )
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
