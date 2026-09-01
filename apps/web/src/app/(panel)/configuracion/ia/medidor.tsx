import { cupoDeContactosDeCuenta } from '@/lib/cupo'

/**
 * Cuántos contactos del plan lleva usados la cuenta.
 *
 * Existe porque un tope que el cliente no puede ver no es un tope, es una
 * sorpresa. Cuando se llena, los contactos nuevos siguen entrando pero el
 * asistente no los atiende: si nadie lo vio venir, desde afuera parece que el
 * producto se rompió con la gente nueva y anda con la vieja.
 *
 * Se muestra siempre, no solo cuando falta poco. El que va por 80 de 300
 * también quiere saberlo — es más de la cuarta parte de lo que compró.
 *
 * No habla de renovación: el tope es ACUMULADO, no se vacía el mes que viene.
 * Prometer una renovación que no va a pasar es peor que no decir nada.
 */

/** Desde este porcentaje la barra avisa. */
const AVISO = 80
const CRITICO = 95

export async function MedidorDeCupo({ tenantId }: { tenantId: string }) {
  const cupo = await cupoDeContactosDeCuenta(tenantId)

  if (cupo.max === null) {
    return (
      <div className="panel-box" style={{ marginBottom: 16 }}>
        <div className="panel-box-head">
          <h3>Contactos del plan</h3>
          <span className="badge b-blue" style={{ marginLeft: 'auto' }}>
            Sin tope
          </span>
        </div>
        <div className="panel-box-body">
          <p className="mono" style={{ margin: 0, fontSize: 20 }}>
            {cupo.usados.toLocaleString('es-AR')}
          </p>
        </div>
      </div>
    )
  }

  const porcentaje = Math.min(100, Math.round((cupo.usados / cupo.max) * 100))
  const estado =
    porcentaje >= CRITICO ? 'critico' : porcentaje >= AVISO ? 'aviso' : 'ok'

  return (
    <div className="panel-box" style={{ marginBottom: 16 }}>
      <div className="panel-box-head">
        <h3>Contactos del plan</h3>
      </div>
      <div className="panel-box-body">
        <p className="mono" style={{ margin: '0 0 8px', fontSize: 20 }}>
          {cupo.usados.toLocaleString('es-AR')}
          <span className="muted" style={{ fontSize: 14 }}>
            {' '}
            de {cupo.max.toLocaleString('es-AR')}
          </span>
        </p>
        <div
          className={`medidor med-${estado}`}
          role="progressbar"
          aria-valuenow={cupo.usados}
          aria-valuemin={0}
          aria-valuemax={cupo.max}
          aria-label="Contactos usados del plan"
        >
          <div className="medidor-lleno" style={{ width: `${porcentaje}%` }} />
        </div>
        {/*
          El aviso aparece SOLO cuando hay algo que hacer. Un cartel
          permanente explicando el tope se vuelve parte del fondo, y el día
          que de verdad importa nadie lo lee.
        */}
        {!cupo.hayLugar ? (
          <div className="alert alert-red" style={{ marginTop: 12 }}>
            <span>
              Llegaste al límite de contactos de tu plan. Los contactos nuevos
              se siguen recibiendo, pero el asistente no los va a atender hasta
              que mejores el plan. Los que ya tenías siguen igual.
            </span>
          </div>
        ) : estado !== 'ok' ? (
          <div className="alert alert-amber" style={{ marginTop: 12 }}>
            <span>
              Quedan {(cupo.max - cupo.usados).toLocaleString('es-AR')}{' '}
              contactos en tu plan.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
