'use client'

import { useState } from 'react'

/**
 * Armar una campaña: a quién, qué dice, y cómo se va a ver.
 *
 * Sigue el boceto: nombre, destinatarios, mensaje, imagen, y la vista previa
 * al costado. Es de cliente porque las cuatro cosas se miran entre sí — al
 * cambiar un filtro cambia el conteo, al escribir cambia la vista previa— y
 * con un viaje al servidor por tecla no se puede escribir.
 *
 * ======================================================================
 * EL BOTÓN DE ENVIAR ESTÁ APAGADO, Y NO ES UN OLVIDO
 * ======================================================================
 * Fuera de la ventana de 24 h, WhatsApp solo deja salir una PLANTILLA
 * aprobada por Meta. Eso todavía no existe en el sistema: no hay catálogo de
 * plantillas, ni alta, ni envío. Un botón que diga "Enviar campaña" y no
 * mande nada —o peor, que mande y Meta rechace de a uno— es la peor versión
 * posible de esta pantalla.
 *
 * Así que se puede armar y guardar el borrador, y el envío avisa qué falta.
 * Lo que falta está en `recordatorios-y-plantillas.md`.
 */

const MAX_MENSAJE = 1000

type Etapa = { id: string; nombre: string }
type Etiqueta = { id: string; nombre: string }

export function Compositor({
  etapas,
  etiquetas,
  totalContactos,
  rubro,
}: {
  etapas: Etapa[]
  etiquetas: Etiqueta[]
  totalContactos: number
  rubro: string
}) {
  const [nombre, setNombre] = useState('')
  const [destino, setDestino] = useState<'todos' | 'filtros'>('todos')
  const [etapasElegidas, setEtapas] = useState<string[]>([])
  const [etiquetasElegidas, setEtiquetas] = useState<string[]>([])
  const [mensaje, setMensaje] = useState('')

  // Cuántos van a recibirla. Con filtros puestos no se puede saber sin
  // preguntarle al servidor, así que se dice eso en vez de inventar un
  // número: un conteo que después no coincide con lo que salió es peor que
  // no tener conteo.
  const hayFiltros = etapasElegidas.length > 0 || etiquetasElegidas.length > 0
  const alcance =
    destino === 'todos' || !hayFiltros ? totalContactos : null

  function alternar(lista: string[], set: (v: string[]) => void, id: string) {
    set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id])
  }

  return (
    <div className="camp-grid">
      <div>
        <Paso n={1} titulo="Nombre de la campaña">
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Promo Septiembre"
            maxLength={80}
          />
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>
            Es para vos: no lo ve nadie que reciba el mensaje.
          </p>
        </Paso>

        <Paso n={2} titulo="Destinatarios">
          <div className="camp-opciones">
            <Opcion
              elegida={destino === 'todos'}
              onClick={() => setDestino('todos')}
              titulo="Todos"
              detalle={`Los ${totalContactos} ${rubro} con teléfono`}
            />
            <Opcion
              elegida={destino === 'filtros'}
              onClick={() => setDestino('filtros')}
              titulo="Por filtros"
              detalle="Segmentá por etapa o etiqueta"
            />
          </div>

          {destino === 'filtros' && (
            <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
              <Grupo titulo="Etapa">
                {etapas.map((e) => (
                  <Chip
                    key={e.id}
                    activa={etapasElegidas.includes(e.id)}
                    onClick={() => alternar(etapasElegidas, setEtapas, e.id)}
                  >
                    {e.nombre}
                  </Chip>
                ))}
              </Grupo>
              <Grupo titulo="Etiquetas">
                {etiquetas.length === 0 ? (
                  <span className="tiny muted">
                    Esta cuenta todavía no usa etiquetas.
                  </span>
                ) : (
                  etiquetas.map((t) => (
                    <Chip
                      key={t.id}
                      activa={etiquetasElegidas.includes(t.id)}
                      onClick={() =>
                        alternar(etiquetasElegidas, setEtiquetas, t.id)
                      }
                    >
                      {t.nombre}
                    </Chip>
                  ))
                )}
              </Grupo>
            </div>
          )}

          <div className="camp-alcance">
            <strong>
              {alcance === null
                ? 'Se calcula al guardar'
                : `${alcance} contactos seleccionados`}
            </strong>
            <span className="tiny muted">
              {alcance === null
                ? 'Con filtros puestos, el número exacto sale del servidor.'
                : 'Estos contactos van a recibir la campaña.'}
            </span>
          </div>
        </Paso>

        <Paso n={3} titulo="Mensaje">
          <textarea
            className="input"
            rows={7}
            value={mensaje}
            maxLength={MAX_MENSAJE}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="¡Hola! Te compartimos…"
          />
          <p
            className="tiny muted"
            style={{ margin: '6px 0 0', textAlign: 'right' }}
          >
            {mensaje.length}/{MAX_MENSAJE}
          </p>
        </Paso>
      </div>

      <aside>
        <div className="panel-box camp-preview">
          <div className="panel-box-head">
            <h3>Vista previa</h3>
          </div>
          <div className="panel-box-body">
            <p className="tiny muted" style={{ marginTop: 0 }}>
              Así van a ver tu mensaje.
            </p>
            <div className="camp-burbuja">
              {mensaje.trim() ? (
                mensaje.split('\n').map((l, i) => <p key={i}>{l || ' '}</p>)
              ) : (
                <p className="muted">El mensaje aparece acá mientras escribís.</p>
              )}
            </div>
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              Es aproximada: cada teléfono lo muestra un poco distinto.
            </p>
          </div>
        </div>

        {/*
          Lo que falta para que esto salga. Va acá arriba y no escondido
          detrás del botón: quien arma una campaña tiene que saber ANTES de
          escribirla que todavía no se puede mandar.
        */}
        <div className="alert alert-amber" style={{ marginTop: 16 }}>
          <span>
            Todavía no se puede enviar. WhatsApp solo permite escribirle a
            alguien fuera de las 24 h con una plantilla aprobada por Meta, y
            eso está en desarrollo. Mientras tanto podés dejar la campaña
            armada.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled>
            Guardar borrador
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled>
            Enviar campaña
          </button>
        </div>
      </aside>
    </div>
  )
}

function Paso({
  n,
  titulo,
  children,
}: {
  n: number
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div className="panel-box" style={{ marginBottom: 16 }}>
      <div className="panel-box-head">
        <h3>
          {n}. {titulo}
        </h3>
      </div>
      <div className="panel-box-body">{children}</div>
    </div>
  )
}

function Opcion({
  elegida,
  onClick,
  titulo,
  detalle,
}: {
  elegida: boolean
  onClick: () => void
  titulo: string
  detalle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`camp-opcion${elegida ? ' es-elegida' : ''}`}
      aria-pressed={elegida}
    >
      <strong>{titulo}</strong>
      <span className="tiny muted">{detalle}</span>
    </button>
  )
}

function Grupo({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="tiny" style={{ margin: '0 0 6px', fontWeight: 600 }}>
        {titulo}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

function Chip({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`badge ${activa ? 'b-dark' : 'b-gray'}`}
      style={{ cursor: 'pointer', border: 'none' }}
      aria-pressed={activa}
    >
      {children}
    </button>
  )
}
