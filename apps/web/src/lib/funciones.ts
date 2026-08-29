import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'

/**
 * Qué funciones tiene prendidas cada cuenta.
 *
 * POR QUÉ EXISTE
 * Todos los clientes comparten un contenedor y una base, así que una
 * actualización llega a todos en el mismo instante. Lo que sí se puede es que
 * el código nuevo llegue APAGADO: se prende en una cuenta, se mira unos días,
 * y recién después va para el resto.
 *
 * SU LÍMITE, que conviene tener presente antes de confiarse: esto solo cubre
 * lo que alguien se acordó de poner detrás de un interruptor. Un cambio que
 * rompe una pantalla que ya existía no lo salva ningún interruptor; para eso
 * está poder volver atrás en un minuto (`./crm.sh volver`).
 *
 * EL CATÁLOGO VIVE ACÁ Y NO EN LA BASE
 * Un interruptor solo significa algo si hay una línea de código que lo lee.
 * Con la lista acá, lo que ve el superadmin es exactamente lo que de verdad
 * se puede apagar; en la base solo se guarda la excepción de cada cuenta.
 */

export type Funcion = {
  /** Va tal cual a la base: minúsculas y guiones. Cambiarlo pierde lo elegido. */
  codigo: string
  nombre: string
  /** Qué se apaga exactamente, en una línea. Lo lee alguien decidiendo. */
  detalle: string
  /**
   * Qué pasa en una cuenta que nunca se tocó.
   *
   * Lo NUEVO va en false: esa es toda la idea. En true van las cosas que ya
   * venían funcionando para todos y que apagar sería quitarles algo.
   */
  porDefecto: boolean
}

export const FUNCIONES: Funcion[] = [
  {
    codigo: 'transcripcion',
    nombre: 'Transcribir audios',
    detalle:
      'Pasa a texto los audios que llegan por WhatsApp. Consume la clave de ' +
      'OpenAI y se cobra por minuto de audio.',
    // Ya venía andando para todos: apagarlo por defecto sería sacárselo a
    // quien hoy lo tiene funcionando.
    porDefecto: true,
  },
  {
    codigo: 'alta-manual-contactos',
    nombre: 'Cargar contactos a mano',
    detalle:
      'Agrega "Agregar contacto" al pie de cada columna del tablero. Sirve ' +
      'para el que llama por teléfono o el referido. Ojo: un contacto ' +
      'cargado a mano no tiene conversación de WhatsApp.',
    porDefecto: false,
  },
]

export function buscarFuncion(codigo: string): Funcion | undefined {
  return FUNCIONES.find((f) => f.codigo === codigo)
}

/**
 * El estado de todas las funciones en una cuenta.
 *
 * Va por `withSystem` porque se consulta también desde la ingesta y desde el
 * agente, que corren sin sesión: ahí la cuenta se resuelve a partir de una
 * fila de la base, no de un request. El tenantId que entra acá siempre viene
 * de la sesión del servidor o de una fila ya existente, nunca del navegador.
 */
export async function funcionesDe(
  tenantId: string,
): Promise<Record<string, boolean>> {
  const estado: Record<string, boolean> = {}
  for (const f of FUNCIONES) estado[f.codigo] = f.porDefecto

  const res = await withSystem((tx) =>
    tx.execute(sql`
      select codigo, activo from tenant_features where tenant_id = ${tenantId}
    `),
  )
  for (const r of res.rows as { codigo: string; activo: boolean }[]) {
    // Solo lo que el código conoce. Una fila de un interruptor que ya no
    // existe se ignora en vez de aparecer de la nada en una pantalla.
    if (r.codigo in estado) estado[r.codigo] = Boolean(r.activo)
  }
  return estado
}

/**
 * ¿Está prendida esta función en esta cuenta?
 *
 * Ante cualquier problema para averiguarlo, devuelve el valor por defecto en
 * vez de tirar el error para arriba. Una función que no anda es un problema;
 * una ingesta de mensajes que se cae porque no se pudo leer un interruptor es
 * mucho peor.
 */
export async function funcionActiva(
  codigo: string,
  tenantId: string,
): Promise<boolean> {
  const porDefecto = buscarFuncion(codigo)?.porDefecto ?? false
  try {
    const res = await withSystem((tx) =>
      tx.execute(sql`
        select activo from tenant_features
         where tenant_id = ${tenantId} and codigo = ${codigo}
      `),
    )
    const fila = res.rows[0] as { activo: boolean } | undefined
    return fila ? Boolean(fila.activo) : porDefecto
  } catch (err) {
    console.error('[funciones] no se pudo leer el interruptor', codigo, err)
    return porDefecto
  }
}

/**
 * El estado de una función en TODAS las cuentas, para la pantalla del
 * superadmin. Una sola consulta y no una por cuenta.
 */
export type EstadoEnCuenta = {
  tenantId: string
  nombre: string
  slug: string
  /** null = nunca se tocó, vale el valor por defecto. */
  explicito: boolean | null
}

export async function estadoPorCuenta(
  codigo: string,
): Promise<EstadoEnCuenta[]> {
  const res = await withSystem((tx) =>
    tx.execute(sql`
      select t.id, t.name, t.slug, f.activo
        from tenants t
        left join tenant_features f
               on f.tenant_id = t.id and f.codigo = ${codigo}
       order by t.name
    `),
  )
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    tenantId: String(r.id),
    nombre: String(r.name),
    slug: String(r.slug),
    explicito: r.activo === null || r.activo === undefined ? null : Boolean(r.activo),
  }))
}
