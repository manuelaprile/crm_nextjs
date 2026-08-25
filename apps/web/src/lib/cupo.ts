import 'server-only'
import { sql } from 'drizzle-orm'
import type { Db } from './db/client'

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
  max: number
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
  const max = Number(fila?.max ?? 1)
  const usados = Number(fila?.usados ?? 0)
  return {
    usados,
    max,
    inactivos: Number(fila?.inactivos ?? 0),
    hayLugar: usados < max,
  }
}
