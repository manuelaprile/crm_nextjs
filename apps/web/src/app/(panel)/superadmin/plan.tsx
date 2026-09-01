'use client'

import { useState } from 'react'
import { cambiarPlanCuenta } from '@/lib/plataforma'
import { PLANES, buscarPlan } from '@/lib/planes'
import type { FilaCuenta } from '@/lib/usuarios'

/**
 * Cambiar el plan de una cuenta, desde la vista de plataforma.
 *
 * Es un componente de cliente por UNA razón concreta: elegir "Pro" tiene que
 * completar los cuatro límites de una. Sin eso hay que acordarse de memoria
 * cuántos usuarios trae cada plan y cargarlos a mano, que es exactamente la
 * desincronización que el catálogo existe para evitar.
 *
 * Los campos quedan editables después de elegir. Es a propósito: "Start pero
 * con 5 usuarios" es una negociación normal, y tiene que resolverse
 * cambiando un número, no inventando un plan en el código.
 *
 * Vacío = SIN TOPE. No es lo mismo que 0, que en usuarios significaría que la
 * cuenta no puede crear a nadie.
 *
 * La fecha de contratación NO se toca al elegir un plan del catálogo: es un
 * hecho de esta cuenta, no una propiedad del plan. Cambiarla mueve el día en
 * que al cliente se le renuevan las conversaciones, así que se cambia a
 * propósito o no se cambia.
 */
export function CambiarPlan({ cuenta }: { cuenta: FilaCuenta }) {
  const [plan, setPlan] = useState(cuenta.plan)
  const [maxUsuarios, setMaxUsuarios] = useState(txt(cuenta.maxUsuarios))
  const [maxNumeros, setMaxNumeros] = useState(txt(cuenta.maxNumeros))
  const [cupoIa, setCupoIa] = useState(txt(cuenta.cupoIa))
  const [topeGasto, setTopeGasto] = useState(cuenta.topeIa ?? '')
  const [planDesde, setPlanDesde] = useState(cuenta.planDesde)

  // Al elegir un plan del catálogo se cargan sus números. Si el código no
  // está en el catálogo —una cuenta vieja con un plan a mano— no se pisa
  // nada: no hay de dónde sacar los valores y borrarlos sería peor.
  function elegirPlan(codigo: string) {
    setPlan(codigo)
    const p = buscarPlan(codigo)
    if (!p) return
    setMaxUsuarios(txt(p.maxUsuarios))
    setMaxNumeros(txt(p.maxNumeros))
    setCupoIa(txt(p.conversacionesIa))
    setTopeGasto(txt(p.topeGastoUsd))
  }

  const delCatalogo = buscarPlan(cuenta.plan)

  return (
    <details className="sa-plan">
      <summary className="tiny">
        {delCatalogo?.nombre ?? cuenta.plan}
      </summary>
      <div className="sa-borrar-panel">
        <form action={cambiarPlanCuenta} style={{ display: 'grid', gap: 10 }}>
          <input type="hidden" name="tenantId" value={cuenta.id} />
          <input type="hidden" name="nombre" value={cuenta.name} />

          <div className="field">
            <label className="tiny" htmlFor={`plan-${cuenta.id}`}>Plan</label>
            <select
              id={`plan-${cuenta.id}`}
              name="plan"
              className="select"
              value={plan}
              onChange={(e) => elegirPlan(e.target.value)}
            >
              {PLANES.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nombre}
                  {p.precioUsd === null ? ' (a cotizar)' : ` — USD ${p.precioUsd}/mes`}
                </option>
              ))}
              {/* Una cuenta con un plan que no está en el catálogo no puede
                  perder su valor solo por abrir este panel. */}
              {!delCatalogo && (
                <option value={cuenta.plan}>{cuenta.plan}</option>
              )}
            </select>
          </div>

          <div className="sa-plan-nums">
            <Campo
              id={`us-${cuenta.id}`} name="maxUsuarios" label="Usuarios"
              value={maxUsuarios} onChange={setMaxUsuarios}
            />
            <Campo
              id={`wa-${cuenta.id}`} name="maxNumeros" label="Números"
              value={maxNumeros} onChange={setMaxNumeros}
            />
            <Campo
              id={`ia-${cuenta.id}`} name="cupoIa" label="Conversaciones"
              value={cupoIa} onChange={setCupoIa}
            />
            <Campo
              id={`gs-${cuenta.id}`} name="topeGasto" label="Tope USD"
              value={topeGasto} onChange={setTopeGasto}
            />
          </div>

          <div className="field">
            <label className="tiny" htmlFor={`pd-${cuenta.id}`}>
              Contrató el
            </label>
            <input
              id={`pd-${cuenta.id}`}
              name="planDesde"
              type="date"
              className="input"
              value={planDesde}
              onChange={(e) => setPlanDesde(e.target.value)}
            />
          </div>

          <p className="tiny muted" style={{ margin: 0 }}>
            Vacío = sin tope. El cupo se renueva todos los{' '}
            {Number(cuenta.planDesde.slice(8, 10))} de cada mes: lleva{' '}
            {cuenta.iaCiclo} de este ciclo, que va del{' '}
            {corto(cuenta.cicloInicio)} al {corto(cuenta.cicloFin)}.
          </p>

          <button type="submit" className="btn btn-primary btn-sm">
            Guardar plan
          </button>
        </form>
      </div>
    </details>
  )
}

function Campo({
  id, name, label, value, onChange,
}: {
  id: string
  name: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="field">
      <label className="tiny" htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        className="input"
        inputMode="numeric"
        autoComplete="off"
        placeholder="sin tope"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function txt(n: number | null): string {
  return n === null ? '' : String(n)
}

/** '2026-10-10' → '10/10'. El año sobra: el ciclo dura un mes. */
function corto(iso: string): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—'
}
