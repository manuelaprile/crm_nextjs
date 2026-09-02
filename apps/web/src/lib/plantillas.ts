import 'server-only'
import { sql } from 'drizzle-orm'
import { withTenant } from './db/client'
import { puertaDelModulo } from './campanas'
import {
  listarPlantillas,
  type PlantillaZernio,
} from './zernio'

/**
 * Las plantillas de mensaje de la cuenta.
 *
 * SE LEEN DE META CADA VEZ, no se guardan acá. El texto y el estado los
 * maneja Meta: una plantilla puede pasar de PENDING a APPROVED sin que nadie
 * de este lado se entere, o ser rechazada, o editarse. Una copia local
 * envejecería en silencio y la pantalla mostraría un texto distinto del que
 * sale — que es exactamente el error que no se puede cometer cuando lo que
 * sale le llega a trescientas personas.
 *
 * Van por el módulo Campañas y no por uno propio: sin plantillas aprobadas,
 * Campañas no manda nada, y sin campañas las plantillas no sirven para nada.
 * Dos interruptores para algo que siempre va junto es una forma de que
 * alguien prenda uno y el cliente vea una pantalla rota.
 */

export type { PlantillaZernio }
export { conValores, huecosDe } from './plantillas-texto'

export type EstadoPlantillas =
  | { ok: true; plantillas: PlantillaZernio[] }
  | { ok: false; motivo: 'sin-numero' | 'error'; detalle?: string }

/**
 * El `accountId` de Zernio de esta cuenta.
 *
 * Sale de `channel_accounts.external_id`, que es donde lo guarda el alta. Si
 * la cuenta todavía no conectó su número por la vía oficial, no hay
 * plantillas que mostrar ni forma de crearlas: las plantillas viven en la
 * WABA del cliente, no en la nuestra.
 */
export async function cuentaZernioDelTenant(): Promise<string | null> {
  const session = await puertaDelModulo()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select external_id from channel_accounts
       where channel = 'whatsapp' and provider = 'zernio'
         and external_id is not null
       limit 1
    `)
    const fila = res.rows[0] as { external_id: string | null } | undefined
    return fila?.external_id ? String(fila.external_id) : null
  })
}

export async function plantillasDeLaCuenta(): Promise<EstadoPlantillas> {
  const accountId = await cuentaZernioDelTenant()
  if (!accountId) return { ok: false, motivo: 'sin-numero' }

  const r = await listarPlantillas(accountId)
  if (!r.ok) return { ok: false, motivo: 'error', detalle: r.error }
  // Las más nuevas y las que se pueden usar, primero.
  const orden = { APPROVED: 0, PENDING: 1, REJECTED: 2 } as Record<string, number>
  return {
    ok: true,
    plantillas: r.data.sort(
      (a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9),
    ),
  }
}

/** Solo las que se pueden mandar. Es lo que ve el compositor de campañas. */
export async function plantillasAprobadas(): Promise<PlantillaZernio[]> {
  const r = await plantillasDeLaCuenta()
  return r.ok ? r.plantillas.filter((p) => p.estado === 'APPROVED') : []
}
