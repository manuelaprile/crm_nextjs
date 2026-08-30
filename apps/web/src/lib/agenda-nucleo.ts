import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import { configAgenda, dentroDeHorario, type Turno } from './agenda'

/**
 * Crear, mover y cancelar turnos.
 *
 * Vive aparte de las acciones del panel porque tiene DOS clientes: la
 * pantalla de agenda y el asistente. Si cada uno escribiera por su lado, uno
 * de los dos se olvidaría de mover la etapa del contacto o de dejar la nota,
 * y la diferencia recién se notaría al mirar un reporte raro. Es la misma
 * razón por la que existe un solo `deliverMessage`.
 */

export type ResultadoTurno =
  | { ok: true; turno: Turno; etapaMovida: string | null }
  | { ok: false; error: string }

/**
 * El código SQLSTATE de un error, esté donde esté.
 *
 * Drizzle envuelve el error de `pg` en uno propio y deja el original en
 * `cause`, así que leer `err.code` a secas devuelve undefined y todo termina
 * en el mensaje genérico. Pasó: un horario ocupado decía "No se pudo guardar
 * el turno", que no le dice a nadie que pruebe con otro horario. Se recorre
 * la cadena en vez de asumir la forma del error, que cambia entre versiones.
 */
function codigoSql(err: unknown): string | null {
  let actual: unknown = err
  for (let i = 0; i < 5 && actual; i++) {
    const codigo = (actual as { code?: unknown }).code
    if (typeof codigo === 'string' && /^[0-9A-Z]{5}$/.test(codigo)) return codigo
    actual = (actual as { cause?: unknown }).cause
  }
  return null
}

/** Traduce los errores de Postgres a algo que se pueda leer en pantalla. */
function traducir(err: unknown): string {
  const codigo = codigoSql(err)
  if (codigo === '23P01') {
    return 'Ese horario ya está ocupado por otro turno.'
  }
  if (codigo === '23514') {
    return 'El horario no cierra: revisá que termine después de empezar y que no dure más de 12 horas.'
  }
  console.error('[agenda] error inesperado', err)
  return 'No se pudo guardar el turno.'
}

/**
 * Mueve el contacto a la etapa configurada para cuando se agenda.
 *
 * Devuelve el nombre de la etapa si hubo movimiento, o null. No lanza: que
 * falle mover la etapa no puede tirar abajo un turno que ya está guardado —
 * el turno es el dato que importa y la etapa se puede corregir a mano.
 *
 * La etapa sale de la configuración de la cuenta y NO de un nombre fijo.
 * Cada cliente arma sus etapas: "Interesado" es como se llama en una, y en
 * la próxima puede ser "Visita agendada" o no existir.
 */
async function moverEtapa(params: {
  tenantId: string
  contactId: string
  etapaId: string | null
  userId: string | null
  porIa: boolean
  motivo: string
}): Promise<string | null> {
  const { tenantId, contactId, etapaId, userId, porIa, motivo } = params
  if (!etapaId) return null

  try {
    return await withSystem(async (tx) => {
      const et = await tx.execute(sql`
        select id, name from stages
         where id = ${etapaId} and tenant_id = ${tenantId}
      `)
      const etapa = et.rows[0] as { id: string; name: string } | undefined
      if (!etapa) return null

      const prev = await tx.execute(sql`
        select stage_id from contacts
         where id = ${contactId} and tenant_id = ${tenantId}
      `)
      const desde = (prev.rows[0]?.stage_id as string | null) ?? null
      // Ya está ahí: no se registra un movimiento que no ocurrió. Sin este
      // corte, reagendar tres veces suma tres filas al historial y el embudo
      // muestra un movimiento por cada cambio de horario.
      if (desde === etapa.id) return null

      await tx.execute(sql`
        update contacts set stage_id = ${etapa.id}, stage_since = now()
         where id = ${contactId} and tenant_id = ${tenantId}
      `)
      await tx.execute(sql`
        insert into stage_history
          (tenant_id, contact_id, from_stage_id, to_stage_id, changed_by,
           by_ai, reason)
        values (${tenantId}, ${contactId}, ${desde}, ${etapa.id}, ${userId},
                ${porIa}, ${motivo})
      `)
      return etapa.name
    })
  } catch (err) {
    console.error('[agenda] no se pudo mover la etapa', err)
    return null
  }
}

/**
 * Agenda un turno.
 *
 * `validarHorario` es la diferencia entre la IA y una persona. Al asistente
 * se le comprueba que el horario caiga dentro de la atención del negocio,
 * porque puede inventar uno que le suene razonable. A la secretaria no: si
 * carga algo un sábado sabe lo que hace, y el sistema no está para
 * discutirle.
 */
export async function crearTurno(params: {
  tenantId: string
  contactId: string | null
  conversationId?: string | null
  titulo: string
  tipo?: string | null
  notas?: string | null
  inicia: Date
  termina: Date
  userId?: string | null
  /**
   * A quién le toca atenderlo.
   *
   * `undefined` no es lo mismo que `null`: sin el campo, se deduce de quién
   * viene siguiendo a esa persona (ver `responsableDeducido`); con `null`
   * explícito, el turno queda sin responsable porque así se pidió.
   */
  asignadoA?: string | null
  porIa?: boolean
  validarHorario?: boolean
}): Promise<ResultadoTurno> {
  const config = await configAgenda(params.tenantId)

  if (params.validarHorario && !dentroDeHorario(params.inicia, params.termina, config)) {
    return {
      ok: false,
      error: 'Ese horario cae fuera de la atención del negocio.',
    }
  }

  const asignado =
    params.asignadoA !== undefined
      ? params.asignadoA
      : await responsableDeducido(
          params.tenantId,
          params.contactId,
          params.conversationId ?? null,
        )

  let id: string
  try {
    id = await withSystem(async (tx) => {
      const res = await tx.execute(sql`
        insert into appointments
          (tenant_id, contact_id, conversation_id, titulo, tipo, notas,
           starts_at, ends_at, creado_por, creado_por_ia, assigned_user_id)
        values (${params.tenantId}, ${params.contactId}, ${params.conversationId ?? null},
                ${params.titulo}, ${params.tipo ?? null}, ${params.notas ?? null},
                ${params.inicia.toISOString()}, ${params.termina.toISOString()},
                ${params.userId ?? null}, ${params.porIa ?? false}, ${asignado})
        returning id
      `)
      return String(res.rows[0]!.id)
    })
  } catch (err) {
    return { ok: false, error: traducir(err) }
  }

  const etapaMovida = params.contactId
    ? await moverEtapa({
        tenantId: params.tenantId,
        contactId: params.contactId,
        etapaId: config.etapaAlAgendar,
        userId: params.userId ?? null,
        porIa: params.porIa ?? false,
        motivo: `Se agendó: ${params.titulo}`,
      })
    : null

  const { turnoPorId } = await import('./agenda')
  const turno = await turnoPorId(params.tenantId, id)
  if (!turno) return { ok: false, error: 'El turno se guardó pero no se pudo leer.' }
  return { ok: true, turno, etapaMovida }
}

/**
 * Mueve un turno a otro horario.
 *
 * Se actualiza la fila en vez de cancelar y crear otra: así el turno
 * conserva su id, y cualquier cosa que lo referencie —una nota, un mensaje
 * que dice "te esperamos"— sigue apuntando al mismo lugar.
 */
export async function reagendarTurno(params: {
  tenantId: string
  id: string
  inicia: Date
  termina: Date
  userId?: string | null
  porIa?: boolean
  validarHorario?: boolean
}): Promise<ResultadoTurno> {
  const config = await configAgenda(params.tenantId)

  if (params.validarHorario && !dentroDeHorario(params.inicia, params.termina, config)) {
    return { ok: false, error: 'Ese horario cae fuera de la atención del negocio.' }
  }

  try {
    const filas = await withSystem(async (tx) => {
      const res = await tx.execute(sql`
        update appointments
           set starts_at = ${params.inicia.toISOString()},
               ends_at = ${params.termina.toISOString()},
               status = 'programada'
         where id = ${params.id} and tenant_id = ${params.tenantId}
        returning id
      `)
      return res.rows.length
    })
    if (!filas) return { ok: false, error: 'Ese turno no existe.' }
  } catch (err) {
    return { ok: false, error: traducir(err) }
  }

  const { turnoPorId } = await import('./agenda')
  const turno = await turnoPorId(params.tenantId, params.id)
  if (!turno) return { ok: false, error: 'El turno se movió pero no se pudo leer.' }
  return { ok: true, turno, etapaMovida: null }
}

/**
 * Cambia el estado de un turno: cancelado, cumplido o ausente.
 *
 * Cancelar NO borra. "Se canceló" y "no vino" son datos comerciales: sin
 * ellos, el reporte de un mes con muchas cancelaciones se ve idéntico a uno
 * sin turnos. Borrar de verdad existe aparte, para el turno cargado por
 * error.
 */
export async function cambiarEstadoTurno(params: {
  tenantId: string
  id: string
  estado: 'programada' | 'cumplida' | 'ausente' | 'cancelada'
}): Promise<ResultadoTurno> {
  try {
    const filas = await withSystem(async (tx) => {
      const res = await tx.execute(sql`
        update appointments set status = ${params.estado}::appointment_status
         where id = ${params.id} and tenant_id = ${params.tenantId}
        returning id
      `)
      return res.rows.length
    })
    if (!filas) return { ok: false, error: 'Ese turno no existe.' }
  } catch (err) {
    // Volver a "programada" un turno cuyo horario ya ocupa otro choca contra
    // la restricción de exclusión, y está bien que choque.
    return { ok: false, error: traducir(err) }
  }

  const { turnoPorId } = await import('./agenda')
  const turno = await turnoPorId(params.tenantId, params.id)
  if (!turno) return { ok: false, error: 'No se pudo leer el turno.' }
  return { ok: true, turno, etapaMovida: null }
}

export async function borrarTurno(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      delete from appointments where id = ${id} and tenant_id = ${tenantId}
      returning id
    `)
    return res.rows.length > 0
  })
}

/**
 * A quién le toca un turno que nadie atribuyó.
 *
 * Es el caso de la IA: agenda sola, en medio de una conversación, y no tiene
 * a quién preguntarle. La respuesta sale de quien ya venía siguiendo a esa
 * persona —primero el responsable de la conversación, después el dueño del
 * contacto— porque esas dos cosas ya se mantienen sincronizadas entre sí
 * (ver CLAUDE.md) y son la única definición de "a quién le toca" que hay en
 * el sistema. Inventar una segunda acá sería tener dos respuestas distintas
 * a la misma pregunta.
 *
 * Devuelve null cuando el contacto no lo tomó nadie todavía, que es
 * frecuente: el turno queda "de la casa" y lo ven el dueño y los admin, que
 * son justamente quienes pueden asignarlo.
 */
async function responsableDeducido(
  tenantId: string,
  contactId: string | null,
  conversationId: string | null,
): Promise<string | null> {
  if (!contactId && !conversationId) return null
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select coalesce(
               (select v.assigned_user_id from conversations v
                 where v.id = ${conversationId}::uuid and v.tenant_id = ${tenantId}),
               (select c.owner_user_id from contacts c
                 where c.id = ${contactId}::uuid and c.tenant_id = ${tenantId})
             ) as quien
    `)
    const quien = res.rows[0]?.quien
    return quien ? String(quien) : null
  })
}
