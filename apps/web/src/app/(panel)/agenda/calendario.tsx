import Link from 'next/link'
import type { Turno, ConfigAgenda } from '@/lib/agenda'
import { diaEnZona, horaEnZona, partesEnZona } from '@/lib/agenda'

/**
 * Las vistas de calendario: mes, semana y día.
 *
 * TODO SERVIDOR. No hay una línea de JavaScript en el navegador: moverse de
 * semana es un enlace, y abrir un turno también. Una grilla de calendario es
 * de las cosas que más tienta a traer una librería —y las que hay pesan entre
 * 100 y 300 KB, algunas con marca ajena en el pie, que este producto no puede
 * llevar (ver CLAUDE.md)—. Lo que sigue son dos bucles y una resta.
 *
 * La grilla de semana y la de día son la MISMA función con distinta cantidad
 * de columnas. Escribirlas por separado garantiza que dentro de un mes una
 * muestre los turnos cancelados y la otra no.
 */

/** Alto de la grilla, en píxeles por minuto. 1.1 = una hora entra en 66px. */
const PX_POR_MIN = 1.1
/** Si no hay horarios cargados, la grilla igual tiene que empezar y terminar. */
const HORA_POR_DEFECTO = { desde: 8, hasta: 20 }

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

export type Rango = { desde: Date; hasta: Date }

// ---------------------------------------------------------------------
// Cuentas de días. Todas sobre "AAAA-MM-DD" y no sobre Date: el día que
// cambia el horario de verano dura 23 o 25 horas, y sumar 86.400.000
// milisegundos se corre un día. Ver `diasEntre` en lib/fechas.ts.
// ---------------------------------------------------------------------

export function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const f = new Date(Date.UTC(a!, m! - 1, d! + n))
  return f.toISOString().slice(0, 10)
}

/** El lunes de la semana de `dia`. La semana laboral no empieza el domingo. */
export function lunesDe(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const f = new Date(Date.UTC(a!, m! - 1, d!))
  // getUTCDay: 0 = domingo. El lunes está a (día + 6) % 7 días para atrás.
  return sumarDias(dia, -((f.getUTCDay() + 6) % 7))
}

export function primeroDelMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`
}

export function diasDelMes(dia: string): number {
  const [a, m] = dia.split('-').map(Number)
  return new Date(Date.UTC(a!, m!, 0)).getUTCDate()
}

/**
 * La franja horaria que dibuja la grilla.
 *
 * Sale de los horarios de atención del negocio, pero se estira para que
 * entre cualquier turno que caiga afuera. Un turno cargado a mano un sábado
 * a las 22 existe igual, y una grilla que lo deja afuera lo esconde sin
 * decir nada — que es peor que mostrarlo en un horario raro.
 */
export function franja(
  config: ConfigAgenda,
  turnos: Turno[],
): { desde: number; hasta: number } {
  let desde = 24
  let hasta = 0
  for (const tramos of Object.values(config.horarios)) {
    for (const [a, b] of tramos) {
      desde = Math.min(desde, Number(a.slice(0, 2)))
      hasta = Math.max(hasta, Math.ceil(Number(b.slice(0, 2)) + (b.slice(3) === '00' ? 0 : 1)))
    }
  }
  if (desde > hasta) {
    desde = HORA_POR_DEFECTO.desde
    hasta = HORA_POR_DEFECTO.hasta
  }
  for (const t of turnos) {
    const i = partesEnZona(new Date(t.inicia), config.zona)
    const f = partesEnZona(new Date(t.termina), config.zona)
    desde = Math.min(desde, i.hora)
    hasta = Math.max(hasta, f.minuto > 0 ? f.hora + 1 : f.hora)
  }
  return { desde: Math.max(0, desde), hasta: Math.min(24, Math.max(hasta, desde + 1)) }
}

// ---------------------------------------------------------------------
// Grilla de semana y de día
// ---------------------------------------------------------------------

type Colocado = { t: Turno; arriba: number; alto: number; col: number; de: number }

/**
 * Dónde va cada turno dentro de la columna de su día.
 *
 * Dos turnos EN PIE no se pueden pisar: lo impide Postgres. Pero un
 * cancelado o un ausente sí pueden quedar encima de otro, y apilados en el
 * mismo lugar se tapan. Por eso el reparto en columnas: se agrupan los que
 * se solapan entre sí y cada uno se queda con su fracción del ancho.
 */
function colocar(
  turnos: Turno[],
  zona: string,
  desdeHora: number,
): Colocado[] {
  const min = (iso: string) => {
    const p = partesEnZona(new Date(iso), zona)
    return p.hora * 60 + p.minuto - desdeHora * 60
  }

  const ordenados = [...turnos].sort(
    (a, b) => min(a.inicia) - min(b.inicia) || min(a.termina) - min(b.termina),
  )

  const salida: Colocado[] = []
  let grupo: Colocado[] = []
  let finDelGrupo = -1

  const cerrar = () => {
    for (const c of grupo) c.de = grupo.length
    salida.push(...grupo)
    grupo = []
    finDelGrupo = -1
  }

  for (const t of ordenados) {
    const arriba = min(t.inicia)
    // Mínimo 20 minutos de alto: un turno de 10 no deja leer ni la hora.
    const alto = Math.max(20, min(t.termina) - arriba)
    if (arriba >= finDelGrupo && grupo.length) cerrar()
    grupo.push({ t, arriba, alto, col: grupo.length, de: 1 })
    finDelGrupo = Math.max(finDelGrupo, arriba + alto)
  }
  if (grupo.length) cerrar()
  return salida
}

export function Grilla({
  dias,
  turnos,
  config,
  hoy,
  href,
}: {
  /** Los días a dibujar, "AAAA-MM-DD". Uno solo = vista de día. */
  dias: string[]
  turnos: Turno[]
  config: ConfigAgenda
  hoy: string
  /** Cómo se arma el enlace de un turno, para no perder los filtros. */
  href: (extra: Record<string, string | undefined>) => string
}) {
  const { desde, hasta } = franja(config, turnos)
  const altoTotal = (hasta - desde) * 60 * PX_POR_MIN
  const horas = Array.from({ length: hasta - desde }, (_, i) => desde + i)

  const porDia = new Map<string, Turno[]>()
  for (const t of turnos) {
    const dia = diaEnZona(new Date(t.inicia), config.zona)
    porDia.set(dia, [...(porDia.get(dia) ?? []), t])
  }

  return (
    <div className="cal-scroll">
      <div className={`cal cal-${dias.length}`}>
        <div className="cal-esq" />
        {dias.map((dia) => (
          <div key={dia} className={`cal-cab${dia === hoy ? ' hoy' : ''}`}>
            <span className="cal-cab-dia">{DIAS_CORTOS[diaSemana(dia)]}</span>
            <span className="cal-cab-num">{Number(dia.slice(8))}</span>
          </div>
        ))}

        <div className="cal-horas" style={{ height: altoTotal }}>
          {horas.map((h) => (
            <span key={h} className="cal-hora mono" style={{ height: 60 * PX_POR_MIN }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>

        {dias.map((dia) => (
          <div key={dia} className="cal-col" style={{ height: altoTotal }}>
            {horas.map((h) => (
              <div key={h} className="cal-linea" style={{ height: 60 * PX_POR_MIN }} />
            ))}
            {/*
              El sombreado de las horas de atención. Es lo que hace legible
              un hueco: sin él, "no hay nada el martes a las 8" y "no
              atendemos el martes a las 8" se ven exactamente igual.
            */}
            {(config.horarios[String(diaSemana(dia))] ?? []).map(([a, b], i) => {
              const arr = (Number(a.slice(0, 2)) * 60 + Number(a.slice(3)) - desde * 60)
              const fin = (Number(b.slice(0, 2)) * 60 + Number(b.slice(3)) - desde * 60)
              return (
                <div
                  key={i}
                  className="cal-abierto"
                  style={{ top: arr * PX_POR_MIN, height: (fin - arr) * PX_POR_MIN }}
                />
              )
            })}

            {colocar(porDia.get(dia) ?? [], config.zona, desde).map((c) => (
              <Link
                key={c.t.id}
                href={href({ turno: c.t.id, d: dia })}
                className={`cal-turno est-${c.t.estado}`}
                style={{
                  top: c.arriba * PX_POR_MIN,
                  height: c.alto * PX_POR_MIN,
                  left: `calc(${(c.col / c.de) * 100}% + 2px)`,
                  width: `calc(${100 / c.de}% - 4px)`,
                }}
                title={`${horaEnZona(new Date(c.t.inicia), config.zona)} · ${c.t.titulo}${
                  c.t.responsable ? ` · ${c.t.responsable}` : ''
                }`}
              >
                <b>{c.t.titulo}</b>
                <span>
                  {horaEnZona(new Date(c.t.inicia), config.zona)}
                  {c.t.contacto ? ` · ${c.t.contacto}` : ''}
                </span>
                {c.t.responsable ? (
                  <span className="cal-quien">{c.t.responsable}</span>
                ) : null}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Grilla de mes
// ---------------------------------------------------------------------

/** Cuántos turnos entran en la celda de un día antes del "+N más". */
const POR_CELDA = 3

export function Mes({
  ancla,
  turnos,
  config,
  hoy,
  href,
}: {
  /** Cualquier día del mes que se muestra. */
  ancla: string
  turnos: Turno[]
  config: ConfigAgenda
  hoy: string
  href: (extra: Record<string, string | undefined>) => string
}) {
  const mes = ancla.slice(0, 7)
  const arranque = lunesDe(primeroDelMes(ancla))
  // Seis semanas fijas y no las que haga falta: con cinco o seis según el
  // mes, la pantalla cambia de alto al pasar de página y todo salta.
  const celdas = Array.from({ length: 42 }, (_, i) => sumarDias(arranque, i))

  const porDia = new Map<string, Turno[]>()
  for (const t of turnos) {
    const dia = diaEnZona(new Date(t.inicia), config.zona)
    porDia.set(dia, [...(porDia.get(dia) ?? []), t])
  }

  return (
    <div className="mes">
      {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => (
        <div key={d} className="mes-cab">
          {d}
        </div>
      ))}
      {celdas.map((dia) => {
        const delDia = porDia.get(dia) ?? []
        return (
          <Link
            key={dia}
            href={href({ vista: 'dia', d: dia })}
            className={`mes-celda${dia.slice(0, 7) !== mes ? ' fuera' : ''}${
              dia === hoy ? ' hoy' : ''
            }`}
          >
            <span className="mes-num">{Number(dia.slice(8))}</span>
            {delDia.slice(0, POR_CELDA).map((t) => (
              <span key={t.id} className={`mes-turno est-${t.estado}`}>
                <i className="mono">{horaEnZona(new Date(t.inicia), config.zona)}</i>
                {t.titulo}
              </span>
            ))}
            {delDia.length > POR_CELDA ? (
              <span className="mes-mas">+{delDia.length - POR_CELDA} más</span>
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}

/** 0 = domingo, como `Date.getUTCDay` y como las claves de `horarios`. */
function diaSemana(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay()
}
