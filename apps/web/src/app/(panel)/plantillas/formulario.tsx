'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { crearPlantillaAccion } from '@/lib/plantillas-acciones'
import { huecosDe } from '@/lib/plantillas-texto'

/**
 * Escribir una plantilla y mandarla a aprobar.
 *
 * Es de cliente por una razón concreta: Meta EXIGE un ejemplo por cada dato
 * variable, y los datos variables aparecen a medida que se escribe. Con un
 * formulario de servidor habría que mandar, esperar el rechazo de Meta —que
 * tarda— y recién ahí enterarse de que faltaban los ejemplos.
 *
 * Y el rechazo no lo dice: llega como "Invalid format. Check variable syntax
 * ({{1}}, sequential numbering, no special chars)", que manda a revisar las
 * llaves cuando las llaves estaban bien.
 */
export function FormularioPlantilla() {
  const [cuerpo, setCuerpo] = useState('')
  const [ejemplos, setEjemplos] = useState<string[]>([])

  const huecos = huecosDe(cuerpo)

  // Los huecos tienen que ser 1, 2, 3… sin saltos. Se avisa acá y no después
  // del rechazo de Meta, que tarda horas en volver.
  const numeros = [...cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) =>
    Number(m[1]),
  )
  const distintos = [...new Set(numeros)].sort((a, b) => a - b)
  const salteados = distintos.some((n, i) => n !== i + 1)

  // Meta tampoco acepta que el texto empiece o termine con un hueco.
  const enLosBordes =
    /^\s*\{\{\s*\d+\s*\}\}/.test(cuerpo) || /\{\{\s*\d+\s*\}\}\s*$/.test(cuerpo)

  return (
    <form action={crearPlantillaAccion} style={{ display: 'grid', gap: 14 }}>
      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input
          id="nombre"
          name="nombre"
          className="input"
          placeholder="Promo Septiembre"
          maxLength={60}
          required
        />
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          Es para identificarla. No lo ve quien recibe el mensaje.
        </p>
      </div>

      <div className="field">
        <label htmlFor="cuerpo">Texto del mensaje</label>
        <textarea
          id="cuerpo"
          name="cuerpo"
          className="input"
          rows={6}
          maxLength={1024}
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          placeholder={
            'Hola {{1}}, te compartimos nuestra promo de este mes.\n' +
            'Escribinos si querés más información.'
          }
          required
        />
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          Los datos que cambian en cada envío van entre llaves dobles:{' '}
          <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>.
        </p>
      </div>

      {salteados && (
        <div className="alert alert-red">
          <span>
            Los huecos tienen que ir en orden y sin saltos: {'{{1}}'},{' '}
            {'{{2}}'}, {'{{3}}'}…
          </span>
        </div>
      )}
      {enLosBordes && (
        <div className="alert alert-red">
          <span>
            El mensaje no puede empezar ni terminar con un hueco. Meta lo
            rechaza.
          </span>
        </div>
      )}

      {huecos > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <p className="tiny" style={{ margin: 0, fontWeight: 600 }}>
            Un ejemplo de cada dato
          </p>
          {Array.from({ length: huecos }, (_, i) => (
            <div className="field" key={i}>
              <label htmlFor={`ejemplo-${i}`}>
                Qué podría ir en {`{{${i + 1}}}`}
              </label>
              <input
                id={`ejemplo-${i}`}
                name="ejemplo"
                className="input"
                maxLength={120}
                placeholder={i === 0 ? 'Juan' : ''}
                value={ejemplos[i] ?? ''}
                onChange={(e) => {
                  const copia = [...ejemplos]
                  copia[i] = e.target.value
                  setEjemplos(copia)
                }}
                required
              />
            </div>
          ))}
          <p className="tiny muted" style={{ margin: 0 }}>
            Meta los pide para revisar la plantilla. No se envían a nadie: solo
            le muestran para qué sirve cada hueco.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="imagen">Imagen del encabezado (opcional)</label>
        <input
          id="imagen"
          name="imagen"
          type="file"
          accept="image/jpeg,image/png"
          className="input"
        />
      </div>

      <div className="field">
        <label htmlFor="idioma">Idioma</label>
        <select id="idioma" name="idioma" className="select" defaultValue="es_AR">
          <option value="es_AR">Español (Argentina)</option>
          <option value="es">Español</option>
          <option value="es_ES">Español (España)</option>
          <option value="es_MX">Español (México)</option>
          <option value="pt_BR">Portugués (Brasil)</option>
          <option value="en_US">Inglés (EE.UU.)</option>
        </select>
      </div>

      <Boton bloqueado={salteados || enLosBordes} />
    </form>
  )
}

/**
 * El botón, con su estado de "mandando".
 *
 * Es un componente aparte porque `useFormStatus` solo funciona ADENTRO del
 * formulario que está mirando: puesto en `FormularioPlantilla`, que es quien
 * dibuja el `<form>`, devuelve siempre `pending: false`.
 *
 * Mandar una plantilla no es instantáneo —viaja a Zernio y de ahí a Meta— y
 * sin señal la pantalla se queda igual unos segundos. Quien no ve nada
 * vuelve a apretar, y la segunda vez Meta contesta que ya existe una
 * plantilla con ese nombre.
 */
function Boton({ bloqueado }: { bloqueado: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className="btn btn-primary btn-sm"
      style={{ justifySelf: 'start' }}
      disabled={pending || bloqueado}
      aria-busy={pending}
    >
      {pending ? 'Enviando…' : 'Mandar a aprobar'}
    </button>
  )
}
