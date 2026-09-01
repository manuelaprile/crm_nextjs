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
// EL TOPE DE CONTACTOS — LO QUE SE VENDE
// =====================================================================
/**
 * Cuántos contactos entran en el plan y cuántos hay.
 *
 * ACUMULADO, no por mes. Es el tamaño de la lista, como en Mailchimp: lo que
 * el cliente juntó se queda, y cuando llega al tope mejora el plan. Reemplazó
 * al cupo mensual de conversaciones, que describía mal a un CRM —la gente que
 * entró en marzo sigue ahí en septiembre— y que además había que explicarle
 * al cliente. Cuántos contactos tiene ya lo sabe.
 *
 * Los ARCHIVADOS no ocupan lugar. Es lo que hace que el tope se administre
 * solo: el que llegó a 300 limpia lo que no le sirve y sigue, sin llamar a
 * soporte.
 *
 * Esto es para MOSTRARLO. Quién queda adentro y quién afuera lo decide
 * `contacto_dentro_del_plan` en la base, contacto por contacto, y ahí es
 * donde de verdad se corta la IA.
 */
export type CupoContactos = {
  usados: number
  /** null = sin tope (Business). */
  max: number | null
  hayLugar: boolean
}

export async function cupoDeContactos(
  tx: Db,
  tenantId: string,
): Promise<CupoContactos> {
  const res = await tx.execute(sql`
    select t.max_contacts as max,
           (select count(*)::int from contacts c
             where c.tenant_id = t.id and c.archived_at is null) as usados
      from tenants t
     where t.id = ${tenantId}
  `)
  const fila = res.rows[0] as { max: number | null; usados: number } | undefined
  const max = fila?.max === null || fila?.max === undefined ? null : Number(fila.max)
  const usados = Number(fila?.usados ?? 0)
  return { usados, max, hayLugar: dentroDelTope(usados, max) }
}

/**
 * El tope de contactos de una cuenta, para mostrarlo en pantalla.
 *
 * Va por `withSystem` como `funcionesDe`: el `tenantId` sale de la sesión del
 * servidor, nunca del navegador. Ver las reglas de `withSystem` en
 * `db/client.ts`.
 */
export async function cupoDeContactosDeCuenta(
  tenantId: string,
): Promise<CupoContactos> {
  return withSystem((tx) => cupoDeContactos(tx, tenantId))
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
