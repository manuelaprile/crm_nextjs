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
  comoSeLeeDia,
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
  /** A quién le toca atenderlo. null = de la casa, no lo tomó nadie. */
  responsableId: string | null
  responsable: string | null
}

export type ConfigAgenda = {
  iaAgenda: boolean
  duracionIaMin: number
  anticipacionHoras: number
  horizonteDias: number
  /** Por día de la semana (0 = domingo), pares "HH:MM". */
  horarios: Record<string, [string, string][]>
  /**
   * Los horarios de arriba NO los cargó nadie: son el 24 h por defecto.
   *
   * Lo necesitan las dos pantallas que muestran horarios. La de
   * configuración, para no dibujar como elegidos unos horarios que nadie
   * eligió; y el calendario, para no estirar la grilla a 24 filas de alto
   * cuando la cuenta simplemente no configuró nada.
   */
  horariosPorDefecto: boolean
  etapaAlAgendar: string | null
  palabrasClave: string[]
  zona: string
}

const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires'

/**
 * Lo que vale mientras nadie cargue horarios: abierto siempre.
 *
 * Antes valía lo contrario —sin horarios, ningún día abría— y eso dejaba la
 * agenda en un estado muerto: el cliente prendía "que el asistente reserve
 * turnos", el asistente consultaba, no encontraba un solo hueco en ningún
 * día, y contestaba que no hay disponibilidad. Nada fallaba y no había
 * forma de darse cuenta desde afuera de que faltaba un paso.
 *
 * Abierto es el default correcto porque el que no configuró nada todavía no
 * dijo que cierre: cerrar en su nombre es inventarle una restricción. Y el
 * error se ve —ofrece un turno a horario raro— en vez de esconderse.
 *
 * `24:00` es el final del día, no las 23:59: ver `instanteDe`.
 */
export const TODO_EL_DIA: Record<string, [string, string][]> = {
  0: [['00:00', '24:00']], 1: [['00:00', '24:00']], 2: [['00:00', '24:00']],
  3: [['00:00', '24:00']], 4: [['00:00', '24:00']], 5: [['00:00', '24:00']],
  6: [['00:00', '24:00']],
}

/**
 * Con qué arranca el textarea "Ofrecer turno cuando aparezca".
 *
 * NO son un filtro. En ningún lado se compara el mensaje contra esta lista:
 * el texto entra tal cual en el prompt, como "ofrecé turno cuando aparezca
 * algo de esto". El modelo las lee como TEMAS, no como palabras exactas, así
 * que "quiero visitarla", "podemos juntarnos" o "cuándo puedo pasar" caen
 * dentro sin estar escritas acá. Por eso alcanza con siete y no hacen falta
 * las conjugaciones.
 *
 * En minúscula a propósito: van dentro de una oración del prompt, y en
 * mayúscula el modelo las lee como énfasis y ofrece turno de más.
 */
export const PALABRAS_POR_DEFECTO = [
  'visita', 'reunión', 'turno', 'cita', 'agenda', 'reserva', 'entrevista',
]

/**
 * ¿Hay algún día con horario de verdad?
 *
 * Un objeto vacío y uno con los siete días en lista vacía son lo mismo: en
 * los dos casos nadie eligió nada. El formulario produce el primero, pero
 * una cuenta vieja puede tener el segundo.
 */
function sinHorarios(h: Record<string, [string, string][]>): boolean {
  return !Object.values(h ?? {}).some((tramos) => (tramos ?? []).length > 0)
}

/**
 * La configuración, con valores por defecto si la cuenta nunca la tocó.
 *
 * Nunca devuelve null: una cuenta sin configurar tiene agenda igual, con el
 * asistente reservando, abierta las 24 h y con las palabras de arranque.
 * Devolver null obligaría a cada pantalla a decidir qué hacer con eso, y
 * alguna se olvidaría.
 *
 * QUÉ CUENTA COMO "SIN CONFIGURAR", que acá no es lo mismo para todo:
 *
 *  - Para el asistente y las palabras: que NO EXISTA la fila. Apretar
 *    Guardar es una decisión, y "que el asistente no reserve" y "no ofrezcas
 *    turno salvo que te lo pidan" son estados que alguien puede querer. Si
 *    los pisáramos con el default, no habría forma de elegirlos.
 *  - Para los horarios: que no haya ningún día cargado, exista la fila o no.
 *    Ahí "cerrado siempre" no es un estado que nadie quiera —para eso está
 *    el interruptor del asistente—, es la agenda muerta. Ver `TODO_EL_DIA`.
 */
export async function configAgenda(tenantId: string): Promise<ConfigAgenda> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select c.tenant_id as configurada,
             c.ia_agenda, c.duracion_ia_min, c.anticipacion_horas,
             c.horizonte_dias, c.horarios, c.etapa_al_agendar,
             c.palabras_clave, t.timezone
        from tenants t
        left join agenda_config c on c.tenant_id = t.id
       where t.id = ${tenantId}
    `)
    const r = res.rows[0] as Record<string, unknown> | undefined
    const configurada = Boolean(r?.configurada)
    const cargados = (r?.horarios as ConfigAgenda['horarios']) ?? {}
    const porDefecto = sinHorarios(cargados)
    return {
      iaAgenda: configurada ? Boolean(r?.ia_agenda) : true,
      duracionIaMin: Number(r?.duracion_ia_min ?? 30),
      anticipacionHoras: Number(r?.anticipacion_horas ?? 2),
      horizonteDias: Number(r?.horizonte_dias ?? 30),
      horarios: porDefecto ? TODO_EL_DIA : cargados,
      horariosPorDefecto: porDefecto,
      etapaAlAgendar: r?.etapa_al_agendar ? String(r.etapa_al_agendar) : null,
      palabrasClave: configurada
        ? ((r?.palabras_clave as string[]) ?? [])
        : PALABRAS_POR_DEFECTO,
      zona: String(r?.timezone || ZONA_POR_DEFECTO),
    }
  })
}

// ---------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------

const CAMPOS = sql`
  a.id, a.titulo, a.tipo, a.notas, a.starts_at, a.ends_at, a.status,
  a.contact_id, a.conversation_id, a.creado_por_ia, a.assigned_user_id,
  c.display_name as contacto, c.phone as telefono,
  u.name as creado_por, r.name as responsable
`

/**
 * Los dos `join` que necesita CAMPOS. Van juntos y en una constante porque
 * son cuatro consultas distintas: la que se olvide uno rompe con un error de
 * columna, y siempre se olvida la cuarta.
 */
const JOINS = sql`
  left join contacts c on c.id = a.contact_id
  left join users u on u.id = a.creado_por
  left join users r on r.id = a.assigned_user_id
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
    responsableId: r.assigned_user_id ? String(r.assigned_user_id) : null,
    responsable: r.responsable ? String(r.responsable) : null,
  }
}

/**
 * Qué cuenta como "este turno lo involucra".
 *
 * Tres caminos, y hacen falta los tres:
 *
 *  - Le toca a esa persona (`assigned_user_id`). Es el caso normal.
 *  - Lo cargó ella. Una reunión con un proveedor no tiene contacto y puede
 *    no tener responsable, pero quien la puso en la agenda tiene que verla.
 *  - El contacto es suyo. Cubre lo que pasa DESPUÉS: si un contacto se le
 *    pasa a otra persona, sus turnos viejos se van con él. Si esto saliera
 *    solo de `assigned_user_id`, el turno quedaría en la agenda de quien ya
 *    no lo atiende.
 *
 * No es una barrera de seguridad, es el alcance de la pantalla: owner y
 * admin ven la agenda entera. Misma idea que en Contactos (ver CLAUDE.md).
 */
function involucraA(userId: string) {
  return sql`(a.assigned_user_id = ${userId}
              or a.creado_por = ${userId}
              or c.owner_user_id = ${userId})`
}

/**
 * Los turnos de una cuenta en una ventana de tiempo.
 *
 * Los cancelados quedan afuera salvo que se pidan: son ruido en la lista del
 * día, pero se guardan porque "se canceló" es información comercial.
 *
 * `soloDe` recorta a los de una persona. Lo usan dos cosas distintas: el
 * recorte por rol de un operador, y el filtro que un dueño elige a mano para
 * mirar la agenda de alguien de su equipo.
 */
export async function turnosEntre(params: {
  tenantId: string
  desde: Date
  hasta: Date
  incluirCancelados?: boolean
  soloDe?: string
}): Promise<Turno[]> {
  const { tenantId, desde, hasta, incluirCancelados, soloDe } = params
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select ${CAMPOS}
        from appointments a
        ${JOINS}
       where a.tenant_id = ${tenantId}
         and a.starts_at >= ${desde.toISOString()}
         and a.starts_at < ${hasta.toISOString()}
         ${incluirCancelados ? sql`` : sql`and a.status <> 'cancelada'`}
         ${soloDe ? sql`and ${involucraA(soloDe)}` : sql``}
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
        ${JOINS}
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
        ${JOINS}
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
  /**
   * No ofrecer nada antes de este momento. Es lo que permite contestar "la
   * semana que viene" con horarios de la semana que viene.
   *
   * Va SEPARADO de `ahora` a propósito. Antes era el mismo valor, y correr el
   * arranque corría también la anticipación mínima y el horizonte: pedir
   * turnos para dentro de diez días devolvía huecos del día veinte.
   */
  desde?: Date
  /** Solo para pruebas: qué momento se considera "ahora". */
  ahora?: Date
}): Promise<Date[]> {
  const { tenantId, config } = params
  const cuantos = params.cuantos ?? 6
  const ahora = params.ahora ?? new Date()
  const duracionMs = config.duracionIaMin * 60_000

  const minimo = new Date(ahora.getTime() + config.anticipacionHoras * 3_600_000)
  const inicioValido =
    params.desde && params.desde.getTime() > minimo.getTime()
      ? params.desde
      : minimo
  const fin = new Date(
    ahora.getTime() + config.horizonteDias * 24 * 3_600_000,
  )
  if (inicioValido >= fin) return []

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
        // El horizonte también corta acá. Empezando a barrer desde una fecha
        // pedida, el recorrido por días podía pasarse del último día que el
        // cliente quiere ofrecer.
        if (t > fin.getTime()) break
        if (t < inicioValido.getTime()) continue
        const choca = rangos.some(([a, b]) => t < b && t + duracionMs > a)
        if (!choca) libres.push(new Date(t))
      }
    }

    dia = diaEnZona(new Date(ancla.getTime() + 24 * 3_600_000), config.zona)
  }

  return libres
}

/** Por qué un horario no se puede dar. */
export type MotivoOcupado =
  | 'libre'
  | 'pasado'
  | 'muy-pronto'
  | 'fuera-de-horario'
  | 'ocupado'

/**
 * ¿Está libre ESTE horario puntual?
 *
 * Existe porque sin esto no había forma de contestar "¿tenés el lunes a las
 * 11?". Lo único disponible era la lista de los primeros huecos libres, y si
 * el horario preguntado no estaba en esa lista —porque era de otro día, o
 * porque la lista se cortaba antes— el modelo deducía que estaba ocupado.
 * Deducir una ausencia a partir de una lista incompleta es exactamente lo que
 * un modelo hace mal y con seguridad: contestaba "no tengo" sobre horarios
 * que estaban libres.
 *
 * Devuelve el MOTIVO y no un booleano: "ya pasó", "es muy sobre la hora" y
 * "ese día no atendemos" llevan respuestas distintas, y con un `false` a
 * secas el modelo se inventa el motivo.
 */
export async function estaLibre(params: {
  tenantId: string
  config: ConfigAgenda
  inicio: Date
  duracionMin?: number
  ahora?: Date
}): Promise<MotivoOcupado> {
  const { tenantId, config, inicio } = params
  const ahora = params.ahora ?? new Date()
  const fin = new Date(
    inicio.getTime() + (params.duracionMin ?? config.duracionIaMin) * 60_000,
  )

  if (inicio.getTime() <= ahora.getTime()) return 'pasado'
  if (inicio.getTime() < ahora.getTime() + config.anticipacionHoras * 3_600_000) {
    return 'muy-pronto'
  }
  if (!dentroDeHorario(inicio, fin, config)) return 'fuera-de-horario'

  const delDia = await turnosEntre({
    tenantId,
    desde: new Date(inicio.getTime() - 12 * 3_600_000),
    hasta: fin,
  })
  const choca = delDia
    .filter((t) => t.estado === 'programada' || t.estado === 'cumplida')
    .some(
      (t) =>
        inicio.getTime() < new Date(t.termina).getTime() &&
        fin.getTime() > new Date(t.inicia).getTime(),
    )
  return choca ? 'ocupado' : 'libre'
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
