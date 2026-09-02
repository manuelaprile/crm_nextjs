import 'server-only'
import { interruptorActivo } from './funciones'

/**
 * Los módulos que se venden aparte, y cuáles tiene prendidos cada cuenta.
 *
 * ======================================================================
 * UN MÓDULO NO ES UNA FUNCIÓN, AUNQUE SE GUARDEN EN LA MISMA TABLA
 * ======================================================================
 * Las dos cosas se prenden por cuenta y las dos viven en `tenant_features`.
 * Lo que cambia es qué significan, y por eso tienen pantallas separadas:
 *
 *  - Una **función** (`lib/funciones.ts`) es un interruptor de despliegue.
 *    Existe para que lo nuevo salga apagado, se pruebe en una cuenta y
 *    después vaya al resto. Es TEMPORAL: cuando la función está probada en
 *    todos lados, el interruptor se borra y el código se queda.
 *
 *  - Un **módulo** es una unidad comercial. Es lo que el cliente compra o no
 *    compra, es PERMANENTE, y prenderlo o apagarlo es una decisión de venta,
 *    no de despliegue.
 *
 * Mezclarlos en una sola pantalla tiene un costo concreto: el día que alguien
 * limpie interruptores viejos —que es lo correcto hacer con las funciones—
 * se va a encontrar «Campañas» en la misma lista y lo puede apagar creyendo
 * que barre algo terminado. Ahí se le corta el servicio a un cliente que
 * está pagando.
 *
 * ======================================================================
 * EL CÓDIGO LLEVA PREFIJO
 * ======================================================================
 * `modulo-campanas`, no `campanas`. La tabla no distingue los dos mundos y su
 * clave es `(tenant_id, codigo)`: sin prefijo, una función y un módulo que se
 * llamaran igual serían la misma fila y se pisarían en silencio.
 *
 * El separador es un GUION y no dos puntos porque `superadmin_funcion_cuenta`
 * (0022) valida el código contra `^[a-z][a-z0-9-]{1,39}$` y rechaza cualquier
 * otra cosa devolviendo `false`. Con dos puntos, el botón de la pantalla
 * fallaba con un «No se pudo cambiar» que no explicaba nada.
 *
 * El código va a la base, así que cambiarlo pierde lo que cada cuenta tenía
 * elegido. Se elige una vez.
 */

export type Modulo = {
  codigo: string
  nombre: string
  /** Qué le suma a la cuenta, en una línea. Lo lee alguien decidiendo. */
  detalle: string
  /**
   * Qué pasa en una cuenta que nunca se tocó.
   *
   * Un módulo SIEMPRE arranca apagado: es algo que se vende. Un módulo que
   * se prende solo es un módulo regalado.
   */
  porDefecto: false
}

export const MODULOS: Modulo[] = [
  {
    codigo: 'modulo-campanas',
    nombre: 'Campañas',
    detalle:
      'Agrega la sección Campañas al panel del cliente: armar un mensaje, ' +
      'elegir a quiénes va y enviarlo a varios contactos. El envío usa ' +
      'plantillas aprobadas por Meta y lo factura Meta a la cuenta del ' +
      'cliente, no a Impulxy.',
    porDefecto: false,
  },
]

export function buscarModulo(codigo: string): Modulo | undefined {
  return MODULOS.find((m) => m.codigo === codigo)
}

/**
 * ¿Tiene esta cuenta el módulo prendido?
 *
 * Igual que `funcionActiva`: ante cualquier problema para averiguarlo
 * devuelve el valor por defecto —apagado— en vez de tirar el error para
 * arriba. Un módulo que no aparece es un problema; una pantalla que se cae
 * porque no se pudo leer un interruptor es peor.
 */
export async function moduloActivo(
  codigo: string,
  tenantId: string,
): Promise<boolean> {
  return interruptorActivo(codigo, tenantId, buscarModulo(codigo)?.porDefecto ?? false)
}
