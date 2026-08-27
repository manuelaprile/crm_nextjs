import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import { partesEnZona, instanteDe, diaEnZona } from './horarios'

/**
 * La agenda: turnos, visitas y reuniones.
 *
 * Dos cosas que atraviesan todo el archivo:
 *
 * **La hora del negocio no es la del servidor.** Todo se guarda en UTC
 * (`timestamptz`) y se muestra en la zona del cliente, que sale de
 * `tenants.timezone`. Un turno "a las 10" es a las 10 en el consultorio, y
 * el servidor puede estar en cualquier lado.
 *
 * **La superposición la garantiza Postgres**, no este archivo. Acá se
 * calculan huecos libres para poder OFRECERLOS; que dos turnos no se pisen
 * lo asegura una restricción de exclusión (ver 0023_agenda.sql). Es a
 * propósito: la IA agenda sola y dos conversaciones pueden pedir el mismo
 * horario en el mismo instante.
 */

export {
  partesEnZona,
  instanteDe,
  diaEnZona,
  horaEnZona,
  comoSeLee,
} from './horarios'

export type EstadoTurno = 'programada' | 'cumplida' | 'ausente' | 'cancelada'

export type Turno = {
  id: string
  titulo: string
  tipo: string | null
  notas: string | null
  inicia: string
  termina: string
  estado: EstadoTurno
  contactId: string | null
  contacto: string | null
  telefono: string | null
  conversationId: string | null
  creadoPorIa: boolean
  creadoPor: string | null
}

export type ConfigAgenda = {
  iaAgenda: boolean
  duracionIaMin: number
  anticipacionHoras: number
  horizonteDias: number
  /** Por día de la semana (0 = domingo), pares "HH:MM". */
  horarios: Record<string, [string, string][]>
  etapaAlAgendar: string | null
  palabrasClave: string[]
  zona: string
}

const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires'

/**
 * La configuración, con valores por defecto si la cuenta nunca la tocó.
 *
 * Nunca devuelve null: una cuenta sin configurar tiene agenda igual, solo
 * que sin horarios cargados y con la IA apagada. Devolver null obligaría a
 * cada pantalla a decidir qué hacer con eso, y alguna se olvidaría.
 */
export async function configAgenda(tenantId: string): Promise<ConfigAgenda> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select c.ia_agenda, c.duracion_ia_min, c.anticipacion_horas,
             c.horizonte_dias, c.horarios, c.etapa_al_agendar,
             c.palabras_clave, t.timezone
        from tenants t
        left join agenda_config c on c.tenant_id = t.id
       where t.id = ${tenantId}
    `)
    const r = res.rows[0] as Record<string, unknown> | undefined
    return {
      iaAgenda: Boolean(r?.ia_agenda),
      duracionIaMin: Number(r?.duracion_ia_min ?? 30),
      anticipacionHoras: Number(r?.anticipacion_horas ?? 2),
      horizonteDias: Number(r?.horizonte_dias ?? 30),
      horarios: (r?.horarios as ConfigAgenda['horarios']) ?? {},
      etapaAlAgendar: r?.etapa_al_agendar ? String(r.etapa_al_agendar) : null,
      palabrasClave: (r?.palabras_clave as string[]) ?? [],
      zona: String(r?.timezone || ZONA_POR_DEFECTO),
    }
  })
}

// ---------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------

const CAMPOS = sql`
  a.id, a.titulo, a.tipo, a.notas, a.starts_at, a.ends_at, a.status,
  a.contact_id, a.conversation_id, a.creado_por_ia,
  c.display_name as contacto, c.phone as telefono,
  u.name as creado_por
`

function aTurno(r: Record<string, unknown>): Turno {
  return {
    id: String(r.id),
    titulo: String(r.titulo),
    tipo: r.tipo ? String(r.tipo) : null,
    notas: r.notas ? String(r.notas) : null,
    inicia: new Date(String(r.starts_at)).toISOString(),
    termina: new Date(String(r.ends_at)).toISOString(),
    estado: String(r.status) as EstadoTurno,
    contactId: r.contact_id ? String(r.contact_id) : null,
    contacto: r.contacto ? String(r.contacto) : null,
    telefono: r.telefono ? String(r.telefono) : null,
    conversationId: r.conversation_id ? String(r.conversation_id) : null,
    creadoPorIa: Boolean(r.creado_por_ia),
    creadoPor: r.creado_por ? String(r.creado_por) : null,
  }
}

/**
 * Los turnos de una cuenta en una ventana de tiempo.
 *
 * Los cancelados quedan afuera salvo que se pidan: son ruido en la lista del
 * día, pero se guardan porque "se canceló" es información comercial.
 */
export async function turnosEntre(params: {
  tenantId: string
  desde: Date
  hasta: Date
  incluirCancelados?: boolean
}): Promise<Turno[]> {
  const { tenantId, desde, hasta, incluirCancelados } = params
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select ${CAMPOS}
        from appointments a
        left join contacts c on c.id = a.contact_id
        left join users u on u.id = a.creado_por
       where a.tenant_id = ${tenantId}
         and a.starts_at >= ${desde.toISOString()}
         and a.starts_at < ${hasta.toISOString()}
         ${incluirCancelados ? sql`` : sql`and a.status <> 'cancelada'`}
       order by a.starts_at
    `)
    return (res.rows as Record<string, unknown>[]).map(aTurno)
  })
}

export async function turnoPorId(
  tenantId: string,
  id: string,
): Promise<Turno | null> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select ${CAMPOS}
        from appointments a
        left join contacts c on c.id = a.contact_id
        left join users u on u.id = a.creado_por
       where a.tenant_id = ${tenantId} and a.id = ${id}
    `)
    const r = res.rows[0] as Record<string, unknown> | undefined
    return r ? aTurno(r) : null
  })
}

/**
 * Los contactos con un turno por delante.
 *
 * Es lo que la bandeja usa para marcar quién viene. Se resuelve en UNA
 * consulta y no una por conversación: la lista se dibuja en cada latido.
 */
export async function contactosConTurno(
  tenantId: string,
  contactIds: string[],
): Promise<Set<string>> {
  if (!contactIds.length) return new Set()
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select distinct contact_id
        from appointments
       where tenant_id = ${tenantId}
         and status = 'programada'
         and ends_at >= now()
         and contact_id in (${sql.join(
           contactIds.map((c) => sql`${c}::uuid`),
           sql`, `,
         )})
    `)
    return new Set(
      (res.rows as { contact_id: string }[]).map((r) => String(r.contact_id)),
    )
  })
}

/** El próximo turno de un contacto, para mostrarlo en su ficha. */
export async function proximoTurnoDe(
  tenantId: string,
  contactId: string,
): Promise<Turno | null> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select ${CAMPOS}
        from appointments a
        left join contacts c on c.id = a.contact_id
        left join users u on u.id = a.creado_por
       where a.tenant_id = ${tenantId} and a.contact_id = ${contactId}
         and a.status = 'programada' and a.ends_at >= now()
       order by a.starts_at
       limit 1
    `)
    const r = res.rows[0] as Record<string, unknown> | undefined
    return r ? aTurno(r) : null
  })
}

// ---------------------------------------------------------------------
// Huecos libres
// ---------------------------------------------------------------------

/**
 * Los horarios que la IA puede ofrecer.
 *
 * Cruza tres cosas: los horarios de atención cargados, los turnos que ya
 * están, y los límites de anticipación y horizonte. Devuelve instantes, no
 * texto: la conversión a la hora del negocio se hace al final, una sola vez.
 *
 * Barre día por día en la zona del negocio y no sumando 24 horas, porque el
 * día que cambia el horario de verano dura 23 o 25.
 */
export async function huecosLibres(params: {
  tenantId: string
  config: ConfigAgenda
  cuantos?: number
  desde?: Date
}): Promise<Date[]> {
  const { tenantId, config } = params
  const cuantos = params.cuantos ?? 6
  const ahora = params.desde ?? new Date()
  const duracionMs = config.duracionIaMin * 60_000

  const inicioValido = new Date(
    ahora.getTime() + config.anticipacionHoras * 3_600_000,
  )
  const fin = new Date(
    ahora.getTime() + config.horizonteDias * 24 * 3_600_000,
  )

  const ocupados = await turnosEntre({
    tenantId,
    desde: inicioValido,
    hasta: fin,
  })
  const rangos: [number, number][] = ocupados
    .filter((t) => t.estado === 'programada' || t.estado === 'cumplida')
    .map((t) => [new Date(t.inicia).getTime(), new Date(t.termina).getTime()])

  const libres: Date[] = []
  let dia = diaEnZona(inicioValido, config.zona)

  for (let n = 0; n < config.horizonteDias + 1 && libres.length < cuantos; n++) {
    // El mediodía del día que estamos mirando: sirve de ancla para saber qué
    // día de la semana es y para avanzar al siguiente sin caer en el borde.
    const ancla = instanteDe(dia, '12:00', config.zona)
    if (!ancla) break
    const { diaSemana } = partesEnZona(ancla, config.zona)
    const tramos = config.horarios[String(diaSemana)] ?? []

    for (const [abre, cierra] of tramos) {
      const tIni = instanteDe(dia, abre, config.zona)
      const tFin = instanteDe(dia, cierra, config.zona)
      if (!tIni || !tFin || tFin <= tIni) continue

      for (
        let t = tIni.getTime();
        t + duracionMs <= tFin.getTime() && libres.length < cuantos;
        t += duracionMs
      ) {
        if (t < inicioValido.getTime()) continue
        const choca = rangos.some(([a, b]) => t < b && t + duracionMs > a)
        if (!choca) libres.push(new Date(t))
      }
    }

    dia = diaEnZona(new Date(ancla.getTime() + 24 * 3_600_000), config.zona)
  }

  return libres
}

/**
 * ¿Este horario cae dentro de la atención del negocio?
 *
 * Se pregunta antes de que la IA agende algo que ella misma no ofreció —el
 * modelo puede inventar un horario que le suene razonable— y NO se le
 * pregunta a una persona: si la secretaria carga algo un sábado, sabe lo que
 * hace y el sistema no está para discutirle.
 */
export function dentroDeHorario(
  inicio: Date,
  fin: Date,
  config: ConfigAgenda,
): boolean {
  const dia = diaEnZona(inicio, config.zona)
  if (dia !== diaEnZona(new Date(fin.getTime() - 1), config.zona)) return false

  const { diaSemana } = partesEnZona(inicio, config.zona)
  const tramos = config.horarios[String(diaSemana)] ?? []
  return tramos.some(([abre, cierra]) => {
    const a = instanteDe(dia, abre, config.zona)
    const c = instanteDe(dia, cierra, config.zona)
    return !!a && !!c && inicio >= a && fin <= c
  })
}
