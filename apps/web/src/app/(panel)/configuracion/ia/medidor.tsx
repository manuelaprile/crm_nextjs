import { cupoDeIaDeCuenta } from '@/lib/cupo'

/**
 * Cuántas conversaciones del plan lleva usadas la cuenta en este ciclo.
 *
 * Existe porque un cupo que el cliente no puede ver no es un cupo, es una
 * sorpresa. Cuando se agota, el asistente deja de contestar y las
 * conversaciones pasan a una persona: si nadie lo vio venir, desde afuera
 * parece que el producto se rompió.
 *
 * Se muestra siempre, no solo cuando falta poco. El que va por 80 de 500
 * también quiere saberlo — es la mitad de lo que compró.
 */

/** Desde este porcentaje la barra avisa. */
const AVISO = 80
const CRITICO = 95

export async function MedidorDeCupo({ tenantId }: { tenantId: string }) {
  const cupo = await cupoDeIaDeCuenta(tenantId)

  // La fecha viene de la base, no de una cuenta en JavaScript: el cupo se
  // renueva en el aniversario de la contratación —el que contrató un 10 lo
  // renueva todos los 10— y esa fecha la calcula `ciclo_hasta` en la zona de
  // la cuenta. Decir acá "el 1º" era mentira para casi todos.
  //
  // El `T12:00` es a propósito: con `new Date('2026-10-10')` el navegador lee
  // medianoche UTC y en Argentina muestra el 9.
  const cuandoRenueva = cupo.renuevaEl
    ? new Date(`${cupo.renuevaEl}T12:00:00`).toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'long',
      })
    : null

  if (cupo.max === null) {
    return (
      <div className="panel-box" style={{ marginBottom: 16 }}>
        <div className="panel-box-head">
          <h3>Conversaciones de este ciclo</h3>
          <span className="badge b-blue" style={{ marginLeft: 'auto' }}>
            Sin tope
          </span>
        </div>
        <div className="panel-box-body">
          <p className="mono" style={{ margin: 0, fontSize: 20 }}>
            {cupo.usadas.toLocaleString('es-AR')}
          </p>
        </div>
      </div>
    )
  }

  const porcentaje = Math.min(100, Math.round((cupo.usadas / cupo.max) * 100))
  const estado =
    porcentaje >= CRITICO ? 'critico' : porcentaje >= AVISO ? 'aviso' : 'ok'

  return (
    <div className="panel-box" style={{ marginBottom: 16 }}>
      <div className="panel-box-head">
        <h3>Conversaciones de este ciclo</h3>
        {cuandoRenueva ? (
          <span className="tiny muted" style={{ marginLeft: 'auto' }}>
            Se renueva el {cuandoRenueva}
          </span>
        ) : null}
      </div>
      <div className="panel-box-body">
        <p className="mono" style={{ margin: '0 0 8px', fontSize: 20 }}>
          {cupo.usadas.toLocaleString('es-AR')}
          <span className="muted" style={{ fontSize: 14 }}>
            {' '}
            de {cupo.max.toLocaleString('es-AR')}
          </span>
        </p>
        <div
          className={`medidor med-${estado}`}
          role="progressbar"
          aria-valuenow={cupo.usadas}
          aria-valuemin={0}
          aria-valuemax={cupo.max}
          aria-label="Conversaciones atendidas por el asistente en este ciclo"
        >
          <div className="medidor-lleno" style={{ width: `${porcentaje}%` }} />
        </div>
        {/*
          El aviso aparece SOLO cuando hay algo que hacer. Un cartel
          permanente explicando el cupo se vuelve parte del fondo, y el día
          que de verdad importa nadie lo lee.
        */}
        {!cupo.hayLugar ? (
          <div className="alert alert-red" style={{ marginTop: 12 }}>
            <span>
              Se acabaron las conversaciones del plan. El asistente sigue
              recibiendo, pero cada consulta pasa directo a una persona del
              equipo.
            </span>
          </div>
        ) : estado !== 'ok' ? (
          <div className="alert alert-amber" style={{ marginTop: 12 }}>
            <span>
              Quedan {(cupo.max - cupo.usadas).toLocaleString('es-AR')}{' '}
              conversaciones
              {cuandoRenueva ? ` hasta el ${cuandoRenueva}` : ''}.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
