/**
 * Cómo se escriben las fechas en el panel.
 *
 * TODAS pasan por acá, y todas piden la zona. No es burocracia: el panel se
 * dibuja en el SERVIDOR, y el servidor corre en un contenedor con la hora en
 * UTC. `toLocaleString('es-AR')` sin `timeZone` usa la del proceso, así que en
 * producción todo el panel mostraba las horas tres horas adelantadas. Un turno
 * de las 10 de la mañana aparecía como la una de la tarde.
 *
 * No alcanza con fijarle la zona al contenedor: es multi-cuenta, y dos
 * clientes pueden estar en husos distintos mirando el mismo servidor. La zona
 * sale de la sesión (`session.tenantZona`).
 *
 * Sin `server-only` a propósito: son funciones puras y las usan también los
 * componentes de cliente.
 */

/** "27/08/2026" */
export function fecha(iso: string | Date | null, zona: string): string {
  const d = aFecha(iso)
  if (!d) return ''
  return d.toLocaleDateString('es-AR', { timeZone: zona })
}

/** "27/08/2026, 10:00" */
export function fechaHora(iso: string | Date | null, zona: string): string {
  const d = aFecha(iso)
  if (!d) return ''
  return d.toLocaleString('es-AR', {
    timeZone: zona,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** "10:00" */
export function hora(iso: string | Date | null, zona: string): string {
  const d = aFecha(iso)
  if (!d) return ''
  return d.toLocaleTimeString('es-AR', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * La hora si es de hoy, el día y el mes si es más viejo.
 *
 * Es el formato de la lista de conversaciones: lo que importa de un mensaje
 * de hace diez minutos es la hora, y de uno de la semana pasada, el día.
 */
export function horaOFecha(iso: string | Date | null, zona: string): string {
  const d = aFecha(iso)
  if (!d) return ''
  return diaDe(d, zona) === diaDe(new Date(), zona)
    ? hora(d, zona)
    : d.toLocaleDateString('es-AR', {
        timeZone: zona,
        day: '2-digit',
        month: '2-digit',
      })
}

/**
 * "hoy 15:30", "mañana 09:00", "01/09 09:00".
 *
 * Para etiquetas cortas donde lo que se necesita de un vistazo no es la fecha
 * exacta sino si es hoy: eso cambia lo que hace quien está mirando.
 *
 * Antes se quedaba solo con el día en cuanto faltaba más de uno, y en la chapa
 * de la bandeja eso dejaba "Agenda registrada · 31/8": el dato a medias obliga
 * a abrir la conversación justo para lo que la chapa venía a evitar.
 *
 * Es más corta que `diaYHora` —sin "·" y sin "hs"— porque acá compite por el
 * ancho con las otras chapas de la misma fila.
 */
export function cuandoViene(iso: string | Date | null, zona: string): string {
  const d = aFecha(iso)
  if (!d) return ''
  const dias = diasEntre(diaDe(new Date(), zona), diaDe(d, zona))
  if (dias === 0) return `hoy ${hora(d, zona)}`
  if (dias === 1) return `mañana ${hora(d, zona)}`
  const dia = d.toLocaleDateString('es-AR', {
    timeZone: zona,
    day: '2-digit',
    month: '2-digit',
  })
  return `${dia} ${hora(d, zona)}`
}

/**
 * "hoy · 11:00 hs", "mañana · 11:00 hs", "30/05 · 11:00 hs".
 *
 * Como `cuandoViene` pero sin perder la hora cuando falta más de un día: en
 * la tarjeta del contacto la hora ES el dato. Saber que la visita es el 30
 * no sirve para nada si no se sabe si es a las 9 o a las 18.
 */
export function diaYHora(iso: string | Date | null, zona: string): string {
  const d = aFecha(iso)
  if (!d) return ''
  const h = `${hora(d, zona)} hs`
  const dias = diasEntre(diaDe(new Date(), zona), diaDe(d, zona))
  if (dias === 0) return `hoy · ${h}`
  if (dias === 1) return `mañana · ${h}`
  const dia = d.toLocaleDateString('es-AR', {
    timeZone: zona,
    day: '2-digit',
    month: '2-digit',
  })
  return `${dia} · ${h}`
}

function aFecha(v: string | Date | null): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "2026-08-27" en la zona pedida. */
function diaDe(d: Date, zona: string): string {
  // `en-CA` da AAAA-MM-DD, que se compara y se resta sin ambigüedad.
  return d.toLocaleDateString('en-CA', { timeZone: zona })
}

/**
 * Cuántos días hay entre dos "AAAA-MM-DD".
 *
 * Se cuenta sobre los días del calendario y no restando milisegundos: el día
 * que cambia el horario de verano dura 23 o 25 horas, y una resta de
 * milisegundos redondea mal justo ahí.
 */
function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split('-').map(Number)
  const [a2, m2, d2] = hasta.split('-').map(Number)
  return Math.round(
    (Date.UTC(a2!, m2! - 1, d2!) - Date.UTC(a1!, m1! - 1, d1!)) / 86_400_000,
  )
}
