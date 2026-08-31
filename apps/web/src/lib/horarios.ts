/**
 * Horas, días y zonas horarias de la agenda.
 *
 * Módulo aparte y SIN acceso a la base a propósito: es la parte que más
 * fácil se rompe y la que más barato sale probar. Sin `server-only` ni
 * consultas, se ejecuta suelto y se puede verificar contra fechas reales,
 * incluidos los dos domingos al año en que cambia el horario de verano.
 *
 * La regla que ordena todo: se guarda en UTC y se muestra en la zona del
 * negocio (`tenants.timezone`). Un turno "a las 10" es a las 10 en el
 * consultorio, y el servidor puede estar en cualquier lado.
 */

/**
 * Las partes de una fecha, leídas en la zona del negocio.
 *
 * `Intl` es la única forma de hacer esto bien sin una librería: sabe de
 * horario de verano y de cambios de reglas por país. Restar horas a mano
 * funciona once meses al año.
 */
export function partesEnZona(
  fecha: Date,
  zona: string,
): { anio: number; mes: number; dia: number; hora: number; minuto: number; diaSemana: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const p: Record<string, string> = {}
  for (const parte of fmt.formatToParts(fecha)) p[parte.type] = parte.value
  const dias: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    // A las 24:00 lo reporta así en vez de 00:00 en algunos entornos.
    hora: Number(p.hour) % 24,
    minuto: Number(p.minute),
    diaSemana: dias[p.weekday ?? 'Sun'] ?? 0,
  }
}

/** El desfase de una zona respecto de UTC, en minutos, para ese instante. */
function desfaseMin(fecha: Date, zona: string): number {
  const p = partesEnZona(fecha, zona)
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto)
  // Al segundo, para que no se cuele el desfase de los segundos.
  return (comoUtc - Math.floor(fecha.getTime() / 60_000) * 60_000) / 60_000
}

/**
 * Un día y una hora del negocio, convertidos al instante real.
 *
 * `2026-09-02` + `10:00` en Buenos Aires -> `2026-09-02T13:00:00Z`.
 *
 * Se calcula dos veces a propósito: el desfase depende del instante, y el
 * instante es lo que estamos tratando de averiguar. La primera pasada da una
 * aproximación, la segunda la corrige. Solo importa los dos domingos al año
 * en que cambia el horario de verano, y es exactamente cuando un turno mal
 * calculado se nota.
 */
export function instanteDe(
  dia: string,
  hora: string,
  zona: string,
): Date | null {
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia)
  const mh = /^(\d{1,2}):(\d{2})$/.exec(hora)
  if (!md || !mh) return null
  const [, a, m, d] = md
  const [, hh, mm] = mh
  const h = Number(hh)
  const min = Number(mm)

  // Que el día exista, antes de nada.
  //
  // Lo comprobaba la vuelta de más abajo, pero esa comparación no sirve para
  // `24:00`, que cae a propósito en el día siguiente. Validar la fecha acá
  // deja las dos cosas cubiertas: el 30 de febrero sigue sin existir.
  const soloFecha = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)))
  if (diaEnZona(soloFecha, 'UTC') !== dia) return null

  /**
   * `24:00` es el final de ESTE día, no una hora inválida.
   *
   * Un negocio abierto todo el día cierra a las 24:00, no a las 23:59: con
   * 23:59 el último turno de media hora se pierde, porque 23:30 + 30 se pasa
   * del cierre por un minuto. Es medianoche del día siguiente, que es la
   * misma marca de tiempo y se calcula sola con la zona correcta.
   */
  if (h === 24 && min === 0) {
    const siguiente = diaEnZona(
      new Date(Date.UTC(Number(a), Number(m) - 1, Number(d) + 1)),
      'UTC',
    )
    /*
     * Casi siempre esto es medianoche del día siguiente. Pero el domingo que
     * empieza el horario de verano, en varias zonas la medianoche NO EXISTE:
     * en Santiago, el 6/9/2026 el reloj salta de las 23:59 a la 01:00. Ahí
     * `instanteDe` devuelve null —y hace bien, esa hora no ocurrió— y un
     * negocio abierto las 24 h quedaría cerrado todo ese día, una vez al año.
     *
     * El límite entre los dos días existe igual: es el primer instante que ya
     * pertenece al día siguiente. Se lo busca avanzando de a un cuarto de
     * hora, que cubre cualquier salto real (media hora en Lord Howe, una en
     * casi todos lados) sin suponer cuánto dura.
     */
    for (let salto = 0; salto <= 180; salto += 15) {
      const t = instanteDe(
        siguiente,
        `${String(Math.floor(salto / 60)).padStart(2, '0')}:${String(salto % 60).padStart(2, '0')}`,
        zona,
      )
      if (t) return t
    }
    return null
  }
  if (h > 23 || min > 59) return null

  const ingenuo = Date.UTC(Number(a), Number(m) - 1, Number(d), h, min)
  let cand = new Date(ingenuo)
  for (let i = 0; i < 2; i++) {
    cand = new Date(ingenuo - desfaseMin(cand, zona) * 60_000)
  }

  // Que la fecha calculada se lea como la que pidieron.
  //
  // `Date.UTC` no valida: el mes 13 se corre a enero del año siguiente y el
  // 30 de febrero al 2 de marzo, sin decir nada. Un turno pedido para el
  // 2026-13-01 terminaba guardado en 2027 y nadie se enteraba hasta el día
  // que el paciente no aparecía. Comprobar la vuelta atrapa las dos cosas y
  // cualquier otra combinación imposible, sin tener que enumerarlas.
  if (diaEnZona(cand, zona) !== dia) return null
  return cand
}

/** `2026-09-02` tal como se ve el día de esa fecha en la zona del negocio. */
export function diaEnZona(fecha: Date, zona: string): string {
  const p = partesEnZona(fecha, zona)
  return `${p.anio}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`
}

/** `10:00`, en la zona del negocio. */
export function horaEnZona(fecha: Date, zona: string): string {
  const p = partesEnZona(fecha, zona)
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`
}

/**
 * Cómo se lee un turno: "miércoles 2/9 a las 10:00".
 *
 * Armado a mano y no con un solo `Intl`: pidiéndole todo junto devuelve
 * "miércoles 2-9, 10:00", que se lee como un rango de fechas.
 */
export function comoSeLee(fecha: Date, zona: string): string {
  const dia = new Intl.DateTimeFormat('es-AR', {
    timeZone: zona,
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  }).format(fecha)
  return `${dia.replace(/-/g, '/')} a las ${horaEnZona(fecha, zona)}`
}

/** Solo el día, sin hora: "miércoles 2 de septiembre". */
export function comoSeLeeDia(fecha: Date, zona: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: zona,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(fecha)
}
