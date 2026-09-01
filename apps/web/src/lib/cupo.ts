import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem, type Db } from './db/client'
import { dentroDelTope } from './planes'

/**
 * Estados en los que un número NO ocupa lugar en el plan.
 *
 * `logged_out` y `banned` son terminales: el número no está conectado, no
 * consume una sesión, no recibe ni manda nada. Lo único que queda de él es el
 * historial, que no se borra a propósito —las conversaciones cuelgan de la
 * cuenta— pero que tampoco tiene por qué costar un lugar del plan.
 *
 * Contarlos era una trampa con nombre y apellido: alguien que viene del QR y
 * quiere pasarse al canal oficial tiene su cuenta vieja en `logged_out`, no
 * tiene ninguna pantalla para borrarla, y el botón nuevo le dice "alcanzaste
 * el límite de tu plan". Desde afuera es un producto que te cobra por un
 * número que no anda y te impide reemplazarlo.
 *
 * `disconnected` SÍ cuenta: es un número vivo que perdió la conexión y va a
 * volver solo.
 *
 * El número SIMULADO (`provider = 'mock'`) tampoco ocupa. No es un número de
 * WhatsApp: no manda nada afuera, no mantiene sesión y existe justamente para
 * mostrar el sistema andando sin un celular vinculado. Que el demo impida
 * conectar el número de verdad es el mismo callejón sin salida de arriba.
 */

export type Cupo = {
  usados: number
  /** null = sin tope (plan Business). */
  max: number | null
  hayLugar: boolean
  /** Cuántos hay que no ocupan lugar, para poder explicarlo en pantalla. */
  inactivos: number
}

/**
 * Cuántos números de WhatsApp puede tener este consultorio, y cuántos usa.
 *
 * Una sola definición para las tres altas —QR, canal oficial y Zernio—. Con
 * la cuenta hecha en cada archivo, la regla se desincroniza y un camino deja
 * conectar lo que otro rechaza.
 */
export async function cupoDeWhatsApp(tx: Db, tenantId: string): Promise<Cupo> {
  const res = await tx.execute(sql`
    select
      (select max_wa_accounts from tenants where id = ${tenantId}) as max,
      count(*) filter (where status not in ('logged_out','banned'))::int as usados,
      count(*) filter (where status in ('logged_out','banned'))::int as inactivos
    from channel_accounts
    where channel = 'whatsapp' and provider <> 'mock'
  `)
  const fila = res.rows[0] as
    | { max: number | null; usados: number; inactivos: number }
    | undefined
  // `max` en null es SIN TOPE, y hay que distinguirlo de "no vino la fila".
  // Un `?? 1` acá le pondría límite 1 a una cuenta Business.
  const max = fila === undefined ? 1 : fila.max === null ? null : Number(fila.max)
  const usados = Number(fila?.usados ?? 0)
  return {
    usados,
    max,
    inactivos: Number(fila?.inactivos ?? 0),
    hayLugar: dentroDelTope(usados, max),
  }
}

// =====================================================================
// EL CUPO DE IA
// =====================================================================
/**
 * Cuántas conversaciones atendió la IA este mes, y cuántas entran.
 *
 * Una CONVERSACIÓN distinta, no una respuesta: es la unidad con la que se
 * venden los planes ("500 conversaciones atendidas por IA / mes") y es lo que
 * entiende el cliente. Hoy una conversación son unas cinco respuestas del
 * modelo, así que las dos formas de contar dan números que no se parecen.
 *
 * El período es el CICLO DEL PLAN, no el mes calendario: los planes se
 * cobran por fecha de contratación, así que el que contrata un 10 tiene su
 * cupo del 10 al 10. Con el mes calendario, quien contrataba un 25 tenía sus
 * conversaciones hasta fin de mes y otras tantas el 1º —el doble adentro del
 * primer mes que pagó— y "te quedan 40 hasta que se renueve" no se podía
 * decir con precisión. El ancla es `tenants.plan_desde` (0038).
 *
 * Y el día del ciclo es el de la CUENTA, no el de UTC: con la zona del
 * servidor el cupo se le renovaría a las nueve de la noche del día anterior.
 * El corte lo hacen `ciclo_desde` / `ciclo_hasta`, las mismas funciones que
 * usa `superadmin_resumen`.
 *
 * Las lecturas de archivo quedan afuera solas: se registran con
 * `conversation_id` en null (ver `ai/lector.ts`). Cuestan plata pero no
 * atienden a nadie, así que suman al tope de gasto y no a este.
 *
 * Depende de la 0033. Con la llave foránea que había antes, borrar un
 * contacto vaciaba las corridas de su conversación y el cliente se bajaba el
 * contador solo.
 */
export type CupoIa = {
  usadas: number
  /** null = sin tope (Business). */
  max: number | null
  hayLugar: boolean
  /** Cuándo se renueva, en `YYYY-MM-DD`. Sale de la base y no de un cálculo
   *  en JavaScript: es la misma fecha que decide el corte. */
  renuevaEl: string
}

export async function cupoDeIa(tx: Db, tenantId: string): Promise<CupoIa> {
  const res = await tx.execute(sql`
    select t.ai_monthly_conversation_cap as max,
           to_char(ciclo_hasta(t.plan_desde, t.timezone), 'YYYY-MM-DD') as renueva,
           (select count(distinct r.conversation_id)::int from ai_runs r
             where r.tenant_id = t.id
               and r.conversation_id is not null
               and r.created_at >= mes_desde(
                     ciclo_desde(t.plan_desde, t.timezone), t.timezone)
               and r.created_at < mes_desde(
                     ciclo_hasta(t.plan_desde, t.timezone), t.timezone))
             as usadas
      from tenants t
     where t.id = ${tenantId}
  `)
  const fila = res.rows[0] as
    | { max: number | null; usadas: number; renueva: string }
    | undefined
  const max = fila?.max === null || fila?.max === undefined ? null : Number(fila.max)
  const usadas = Number(fila?.usadas ?? 0)
  return {
    usadas,
    max,
    hayLugar: dentroDelTope(usadas, max),
    renuevaEl: fila?.renueva ?? '',
  }
}

/**
 * El cupo de IA de una cuenta, para mostrarlo en pantalla.
 *
 * Va por `withSystem` como `funcionesDe`: `ai_runs` no se consulta desde el
 * panel en ningún otro lado, y el `tenantId` sale de la sesión del servidor,
 * nunca del navegador. Ver las reglas de `withSystem` en `db/client.ts`.
 */
export async function cupoDeIaDeCuenta(tenantId: string): Promise<CupoIa> {
  return withSystem((tx) => cupoDeIa(tx, tenantId))
}

/**
 * Cuántos usuarios tiene la cuenta y cuántos permite el plan.
 *
 * Solo para MOSTRARLO. El control de verdad está en `crearUsuario`, del lado
 * del servidor y dentro de la misma transacción que el alta: un cupo leído
 * para pintar una pantalla nunca puede ser lo que autoriza.
 */
export type CupoUsuarios = { usados: number; max: number | null; hayLugar: boolean }

export async function cupoDeUsuariosDeCuenta(
  tenantId: string,
): Promise<CupoUsuarios> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select (select max_users from tenants where id = ${tenantId}) as max,
             (select count(*)::int from tenant_users
               where tenant_id = ${tenantId}) as usados
    `)
    const fila = res.rows[0] as { max: number | null; usados: number } | undefined
    const max = fila?.max === null || fila?.max === undefined ? null : Number(fila.max)
    const usados = Number(fila?.usados ?? 0)
    return { usados, max, hayLugar: dentroDelTope(usados, max) }
  })
}
