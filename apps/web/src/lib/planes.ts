/**
 * Los planes comerciales, y qué límites pone cada uno.
 *
 * SIN `server-only` a propósito: la pantalla de superadmin es un componente de
 * cliente y necesita el catálogo para armar el desplegable, igual que
 * `ai/models.ts` con los modelos.
 *
 * ======================================================================
 * EL CATÁLOGO VIVE ACÁ, LOS LÍMITES EFECTIVOS EN LA BASE
 * ======================================================================
 * Es la misma división que `lib/funciones.ts` para los interruptores, y por
 * el mismo motivo. En `tenants` se guarda el plan Y sus cuatro números,
 * copiados al momento de asignarlo. Suena a duplicación y no lo es:
 *
 *  - Un cliente puede tener una excepción negociada —"Start pero con 5
 *    usuarios"— sin que haya que inventar un plan nuevo en el catálogo.
 *  - Cambiar un precio o un cupo acá NO le cambia el plan a nadie de un día
 *    para el otro. A los que ya están se les cambia desde la pantalla, uno
 *    por uno y con registro de quién lo hizo.
 *
 * Si los límites se leyeran del catálogo en tiempo real, subir el cupo de
 * Start para vender mejor le subiría el cupo a todos los que ya pagan, y
 * bajarlo se lo bajaría. Ninguna de las dos es una decisión que quieras tomar
 * sin querer.
 *
 * ======================================================================
 * `null` ES "SIN TOPE"
 * ======================================================================
 * Nunca `0` ni un número gigante. En SQL `columna is null` se lee como "sin
 * tope" y no hay forma de confundirlo con "cero permitido", que es
 * exactamente lo que significaría un `0` en `max_users`. Un número gigante
 * es peor todavía: parece un límite real y nadie sabe si 999.999 es "sin
 * tope" o un error de tipeo.
 *
 * Toda comparación pasa por `dentroDelTope()`, que trata el null como
 * ilimitado. En JavaScript `5 >= null` es `true` —porque null se convierte a
 * 0— así que comparar a mano BLOQUEA en vez de permitir. Es el error que
 * había que evitar y por eso la función existe.
 */

export type Plan = {
  /** Va a `tenants.plan`. Minúsculas, sin espacios. */
  codigo: string
  nombre: string
  /** Lo que se cobra por mes. null = a cotizar. */
  precioUsd: number | null
  /** null = sin tope, en todos los que siguen. */
  maxUsuarios: number | null
  maxNumeros: number | null
  /** Conversaciones distintas atendidas por la IA, por mes calendario. */
  conversacionesIa: number | null
  /**
   * Tope de gasto en dólares de IA, por mes.
   *
   * NO es una característica que se venda: es la red de seguridad contra un
   * caso patológico —un catálogo enorme releído en loop, un hilo que se va de
   * madre— que el tope de conversaciones no atrapa, porque cuenta
   * conversaciones y no tokens.
   *
   * Está calculado con holgura sobre lo medido en producción el 31/08/2026:
   * USD 0,006 por conversación, o sea menos de USD 2 en Start y USD 6 en Pro
   * con el cupo lleno. Estos números son más de diez veces eso. Si alguna
   * cuenta lo toca, es un bicho, no un cliente que usa mucho.
   */
  topeGastoUsd: number | null
}

export const PLANES: Plan[] = [
  {
    // `starter`, no `start`: es el default de la columna desde la 0001 y lo
    // que ya tienen todas las cuentas. El código es interno —lo que se
    // muestra es `nombre`— así que se acomoda el catálogo y no los datos.
    codigo: 'starter',
    nombre: 'Start',
    precioUsd: 79,
    maxUsuarios: 3,
    maxNumeros: 1,
    conversacionesIa: 300,
    topeGastoUsd: 25,
  },
  {
    codigo: 'pro',
    nombre: 'Pro',
    precioUsd: 149,
    maxUsuarios: 8,
    maxNumeros: 1,
    conversacionesIa: 900,
    topeGastoUsd: 60,
  },
  {
    codigo: 'business',
    nombre: 'Business',
    // A cotizar según alcance. Los cupos se cargan por cuenta al cerrarlo.
    precioUsd: null,
    maxUsuarios: null,
    maxNumeros: null,
    conversacionesIa: null,
    // Business no queda SIN tope de gasto: "a medida" es una negociación
    // comercial, no una barra libre contra la cuenta de OpenAI. Se sube por
    // cuenta cuando el volumen lo justifica.
    topeGastoUsd: 200,
  },
]

export function buscarPlan(codigo: string): Plan | undefined {
  return PLANES.find((p) => p.codigo === codigo)
}

/**
 * ¿Entra uno más?
 *
 * `max === null` es sin tope. Todo lo demás es `usados < max`.
 *
 * Existe para que nadie escriba `usados >= max` a mano: con `max` en null eso
 * da `true` y bloquea justo a la cuenta que no tiene límite.
 */
export function dentroDelTope(usados: number, max: number | null): boolean {
  return max === null || usados < max
}

/** "3" o "sin tope", para mostrar. */
export function comoSeLeeElTope(max: number | null): string {
  return max === null ? 'sin tope' : String(max)
}
