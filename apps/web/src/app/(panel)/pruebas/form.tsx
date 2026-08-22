'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import {
  simularMensaje,
  crearNumeroSimulado,
  probarIdempotencia,
  limpiarPruebas,
  type Resultado,
} from '@/lib/pruebas'

const EJEMPLOS = [
  'Hola, quería saber cuánto sale la consulta',
  'Buenas, me pasaron el contacto. Quería consultar por una cirugía',
  'Hola! Atienden por OSDE?',
  'Me duele mucho desde ayer', // dispara derivación por palabra clave
]

export function FormSimulador({ numeroListo }: { numeroListo: boolean }) {
  const [res, enviar, enviando] = useActionState<Resultado | null, FormData>(
    simularMensaje,
    null,
  )

  return (
    <div className="panel-box">
      <div className="panel-box-head">
        <div>
          <h3>Simular un mensaje entrante</h3>
          <p className="tiny muted" style={{ marginTop: 3 }}>
            Es lo mismo que haría el worker al recibir un WhatsApp real
          </p>
        </div>
      </div>
      <div className="panel-box-body">
        {!numeroListo && (
          <div className="alert alert-amber" style={{ marginBottom: 16 }}>
            Primero creá el número de prueba con el botón de arriba.
          </div>
        )}

        {res && (
          <div
            className={`alert ${res.ok ? 'alert-green' : 'alert-red'}`}
            style={{ marginBottom: 16 }}
          >
            <span>
              {res.mensaje}
              {res.conversationId && (
                <>
                  {' '}
                  <Link
                    href={`/bandeja/${res.conversationId}`}
                    style={{ textDecoration: 'underline', fontWeight: 600 }}
                  >
                    Ver la conversación →
                  </Link>
                </>
              )}
            </span>
          </div>
        )}

        <form action={enviar} style={{ display: 'grid', gap: 14 }}>
          <div className="cols2b">
            <div className="field">
              <label htmlFor="telefono">Teléfono del paciente</label>
              <input
                id="telefono"
                name="telefono"
                defaultValue="5493511234567"
                className="input mono"
                placeholder="54935..."
              />
            </div>
            <div className="field">
              <label htmlFor="nombre">Nombre (opcional)</label>
              <input
                id="nombre"
                name="nombre"
                defaultValue="Paciente de Prueba"
                className="input"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="texto">Mensaje</label>
            <textarea
              id="texto"
              name="texto"
              rows={3}
              className="input"
              defaultValue={EJEMPLOS[0]}
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
              {EJEMPLOS.map((e, i) => (
                <button
                  key={i}
                  type="button"
                  className="badge b-gray"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    const t = document.getElementById(
                      'texto',
                    ) as HTMLTextAreaElement | null
                    if (t) t.value = e
                  }}
                >
                  {e.length > 34 ? `${e.slice(0, 34)}…` : e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={enviando || !numeroListo}
              className="btn btn-primary"
            >
              {enviando ? 'Enviando…' : 'Enviar mensaje simulado'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function AccionesPrueba({ numeroListo }: { numeroListo: boolean }) {
  const [crear, accionCrear, creando] = useActionState<Resultado | null, FormData>(
    async () => crearNumeroSimulado(),
    null,
  )
  const [idem, accionIdem, probandoIdem] = useActionState<
    Resultado | null,
    FormData
  >(async () => probarIdempotencia(), null)
  const [limpio, accionLimpiar, limpiando] = useActionState<
    Resultado | null,
    FormData
  >(async () => limpiarPruebas(), null)

  const ultimo = crear ?? idem ?? limpio

  return (
    <div className="panel-box" style={{ marginBottom: 16 }}>
      <div className="panel-box-head">
        <h3>Preparación</h3>
      </div>
      <div className="panel-box-body">
        {ultimo && (
          <div
            className={`alert ${ultimo.ok ? 'alert-green' : 'alert-red'}`}
            style={{ marginBottom: 14 }}
          >
            {ultimo.mensaje}
          </div>
        )}

        <div className="toolbar" style={{ marginBottom: 0 }}>
          <form action={accionCrear}>
            <button
              type="submit"
              disabled={creando}
              className={`btn btn-sm ${numeroListo ? 'btn-ghost' : 'btn-primary'}`}
            >
              {creando
                ? 'Creando…'
                : numeroListo
                  ? 'Número de prueba listo ✓'
                  : '1. Crear número de prueba'}
            </button>
          </form>

          <form action={accionIdem}>
            <button
              type="submit"
              disabled={probandoIdem || !numeroListo}
              className="btn btn-ghost btn-sm"
            >
              {probandoIdem ? 'Probando…' : 'Probar idempotencia'}
            </button>
          </form>

          <form action={accionLimpiar} style={{ marginLeft: 'auto' }}>
            <button
              type="submit"
              disabled={limpiando}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--c-danger)' }}
            >
              {limpiando ? 'Limpiando…' : 'Borrar datos de prueba'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
