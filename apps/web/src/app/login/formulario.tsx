'use client'

import { useState } from 'react'

/**
 * El formulario de ingreso, con la aceptación de términos.
 *
 * Es un componente de cliente por UNA razón: si la validación de los términos
 * pasara solo por el servidor, no aceptar el checkbox costaría un viaje de ida
 * y vuelta y el navegador volvería con la contraseña borrada. Alguien que se
 * olvidó de tildar una casilla tendría que escribir todo de nuevo.
 *
 * Tampoco lleva `required` en el checkbox. Con `required` el que aparece es el
 * globito del navegador —en el idioma del navegador, con su estilo— en vez del
 * aviso rojo, y el aviso rojo es lo que se pidió.
 *
 * La validación de verdad igual está en el servidor (`page.tsx`): esto es
 * comodidad, no la barrera. Cualquiera puede mandar el formulario sin pasar por
 * acá.
 */
export function FormularioLogin({
  action,
  error,
  aviso,
}: {
  action: (formData: FormData) => Promise<void>
  error?: string
  aviso?: string
}) {
  const [acepta, setAcepta] = useState(false)
  const [falta, setFalta] = useState(false)

  return (
    <form
      action={action}
      className="login-card"
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(e) => {
        if (!acepta) {
          e.preventDefault()
          setFalta(true)
        }
      }}
    >
      {error && (
        <div className="alert alert-red">
          {error === 'bloqueado'
            ? 'Demasiados intentos fallidos. Esperá 15 minutos.'
            : error === 'terminos'
              ? 'Tenés que aceptar los términos y condiciones para iniciar sesión.'
              : 'Email o contraseña incorrectos.'}
        </div>
      )}

      {/* Un motivo traído de otra pantalla: por qué lo mandamos acá.
          Sin esto, a quien se le vence la sesión en medio de algo le
          aparece el login de la nada y no sabe qué pasó. */}
      {aviso && !error && (
        <div className="alert alert-amber">{aviso.slice(0, 200)}</div>
      )}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="input"
        />
      </div>

      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="input"
        />
      </div>

      <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          name="terminos"
          value="si"
          checked={acepta}
          onChange={(e) => {
            setAcepta(e.target.checked)
            if (e.target.checked) setFalta(false)
          }}
          style={{ marginTop: 3 }}
        />
        <span style={{ fontSize: 13.5 }}>
          Acepto los{' '}
          <a
            href="https://www.impulxy.com/terminos.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            términos y condiciones
          </a>{' '}
          y la{' '}
          <a
            href="https://www.impulxy.com/privacidad.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            política de privacidad
          </a>
          .
        </span>
      </label>

      {/* Solo después de intentar entrar. Un aviso rojo antes de que la
          persona haga nada la trata de distraída de entrada. */}
      {falta && (
        <div className="alert alert-red">
          Tenés que aceptar los términos y condiciones para iniciar sesión.
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-block">
        Ingresar
      </button>
    </form>
  )
}
