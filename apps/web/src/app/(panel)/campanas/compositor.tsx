'use client'

import { useEffect, useState, useTransition } from 'react'
import { guardarCampana, alcanceDe, elegiblesPara } from '@/lib/campanas-acciones'
import type { Campana } from '@/lib/campanas'
import type { OpcionesDeFiltro } from './datos'

/**
 * Armar una campaña: a quién, qué dice, y cómo se va a ver.
 *
 * Componente de cliente porque las cuatro partes se miran entre sí: al tocar
 * un filtro cambia el conteo, al escribir cambia la vista previa. Con un
 * viaje al servidor por tecla no se puede escribir.
 *
 * ======================================================================
 * EL BOTÓN DE ENVIAR ESTÁ APAGADO, Y NO ES UN OLVIDO
 * ======================================================================
 * Fuera de la ventana de 24 h, WhatsApp solo deja salir una PLANTILLA
 * aprobada por Meta. Eso todavía no existe acá: no hay catálogo, ni alta, ni
 * envío. Un botón que diga "Enviar campaña" y no mande nada —o peor, que
 * mande y Meta rechace de a uno— es la peor versión posible de esta pantalla.
 *
 * Guardar SÍ funciona. El plan del envío está en
 * `recordatorios-y-plantillas.md`.
 */

const MAX_MENSAJE = 1000

/**
 * La hora del teléfono simulado.
 *
 * Fija, no la de ahora: con la hora real el servidor dibuja una y el
 * navegador otra, y React avisa de una diferencia de hidratación por algo
 * puramente decorativo.
 */
const HORA = '11:30'

export function Compositor({
  campana,
  opciones,
  negocio,
}: {
  campana: Campana | null
  opciones: OpcionesDeFiltro
  /** Cómo se llama la cuenta: va en el encabezado del teléfono. */
  negocio: string
}) {
  const [nombre, setNombre] = useState(campana?.nombre ?? '')
  const [destino, setDestino] = useState(campana?.destino ?? 'todos')
  const [etapas, setEtapas] = useState<string[]>(campana?.filtros.etapas ?? [])
  const [etiquetas, setEtiquetas] = useState<string[]>(
    campana?.filtros.etiquetas ?? [],
  )
  const [elegidos, setElegidos] = useState<string[]>(campana?.elegidos ?? [])
  const [mensaje, setMensaje] = useState(campana?.mensaje ?? '')
  const [sacarImagen, setSacarImagen] = useState(false)
  const [imagenNueva, setImagenNueva] = useState<string | null>(null)

  const [alcance, setAlcance] = useState<number | null>(null)
  const [contando, empezarConteo] = useTransition()

  /**
   * El conteo lo hace la BASE, no el navegador.
   *
   * Es la misma consulta que va a resolver el envío el día que exista, así
   * que el número que se muestra no puede diferir del que sale. Contar acá
   * exigiría bajarse todos los contactos y además daría otro resultado.
   *
   * Se espera 400 ms desde el último cambio: marcar cinco etiquetas seguidas
   * son cinco consultas si se dispara con cada click, y solo importa la
   * última.
   */
  useEffect(() => {
    const t = setTimeout(() => {
      empezarConteo(async () => {
        setAlcance(await alcanceDe(destino, { etapas, etiquetas }, elegidos))
      })
    }, 400)
    return () => clearTimeout(t)
  }, [destino, etapas, etiquetas, elegidos])

  function alternar(lista: string[], set: (v: string[]) => void, id: string) {
    set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id])
  }

  const imagenActual = campana?.tieneImagen && !sacarImagen && !imagenNueva

  return (
    <form action={guardarCampana} className="camp-grid">
      {campana && <input type="hidden" name="id" value={campana.id} />}
      <input type="hidden" name="destino" value={destino} />
      {etapas.map((e) => (
        <input key={e} type="hidden" name="etapas" value={e} />
      ))}
      {etiquetas.map((e) => (
        <input key={e} type="hidden" name="etiquetas" value={e} />
      ))}
      {elegidos.map((e) => (
        <input key={e} type="hidden" name="elegidos" value={e} />
      ))}
      {sacarImagen && <input type="hidden" name="sacarImagen" value="si" />}

      <div>
        <Paso n={1} titulo="Nombre de la campaña">
          <input
            className="input"
            name="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Promo Septiembre"
            maxLength={80}
            required
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
              detalle={`Los ${opciones.total} contactos con teléfono`}
            />
            <Opcion
              elegida={destino === 'manual'}
              onClick={() => setDestino('manual')}
              titulo="Selección manual"
              detalle="Elegí contactos específicos"
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
                {opciones.etapas.map((e) => (
                  <Chip
                    key={e.id}
                    activa={etapas.includes(e.id)}
                    onClick={() => alternar(etapas, setEtapas, e.id)}
                  >
                    {e.nombre}
                  </Chip>
                ))}
              </Grupo>
              <Grupo titulo="Etiquetas">
                {opciones.etiquetas.length === 0 ? (
                  <span className="tiny muted">
                    Esta cuenta todavía no usa etiquetas.
                  </span>
                ) : (
                  opciones.etiquetas.map((t) => (
                    <Chip
                      key={t.id}
                      activa={etiquetas.includes(t.id)}
                      onClick={() => alternar(etiquetas, setEtiquetas, t.id)}
                    >
                      {t.nombre}
                    </Chip>
                  ))
                )}
              </Grupo>
              <p className="tiny muted" style={{ margin: 0 }}>
                Se guardan los filtros, no la lista. Si mandás esta campaña la
                semana que viene, le va a llegar a quien cumpla con esto en ese
                momento.
              </p>
            </div>
          )}

          {destino === 'manual' && (
            <Buscador elegidos={elegidos} setElegidos={setElegidos} />
          )}

          <div className="camp-alcance">
            <strong>
              {contando || alcance === null
                ? 'Calculando…'
                : `${alcance} contactos seleccionados`}
            </strong>
            <span className="tiny muted">
              Estos contactos van a recibir la campaña.
            </span>
          </div>
        </Paso>

        <Paso n={3} titulo="Mensaje">
          <textarea
            className="input"
            name="mensaje"
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

        <Paso n={4} titulo="Adjuntar imagen (opcional)">
          <input
            type="file"
            name="imagen"
            accept="image/jpeg,image/png"
            className="input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              setImagenNueva(f ? URL.createObjectURL(f) : null)
              if (f) setSacarImagen(false)
            }}
          />
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>
            JPG o PNG, hasta 5 MB.
          </p>

          {(imagenActual || imagenNueva) && (
            <div className="camp-imagen">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagenNueva ?? `/api/campanas/${campana!.id}/imagen`}
                alt="Imagen de la campaña"
              />
              {imagenActual && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSacarImagen(true)}
                >
                  Quitar imagen
                </button>
              )}
            </div>
          )}
          {sacarImagen && (
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>
              La imagen se va a borrar al guardar.
            </p>
          )}
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
            {/*
              El teléfono es de mentira y a propósito se parece al de verdad:
              escribir en un textarea blanco y verlo en un recuadro blanco no
              deja anticipar cómo se lee del otro lado. Un párrafo que en el
              formulario parece corto, en una burbuja de teléfono son ocho
              renglones.
            */}
            <div className="wa">
              <div className="wa-barra">
                <span>{HORA}</span>
                <span>▮▮▮ ⌁</span>
              </div>
              <div className="wa-cabecera">
                <span className="wa-volver" aria-hidden="true">
                  ‹
                </span>
                <span className="wa-avatar" aria-hidden="true">
                  {negocio.trim().charAt(0).toUpperCase() || 'N'}
                </span>
                <span className="wa-quien">
                  <strong>{negocio}</strong>
                  <span>en línea</span>
                </span>
              </div>
              <div className="wa-chat">
                <div className="wa-burbuja">
                  {(imagenActual || imagenNueva) && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={imagenNueva ?? `/api/campanas/${campana!.id}/imagen`}
                      alt=""
                      className="wa-imagen"
                    />
                  )}
                  <div className="wa-texto">
                    {mensaje.trim() ? (
                      mensaje
                        .split('\n')
                        .map((l, i) => <p key={i}>{l || ' '}</p>)
                    ) : (
                      <p className="muted">
                        El mensaje aparece acá mientras escribís.
                      </p>
                    )}
                  </div>
                  <span className="wa-pie">
                    {HORA}
                    <span className="wa-tildes" aria-label="entregado">
                      ✓✓
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <p className="tiny muted" style={{ margin: '10px 0 0' }}>
              Es aproximada: cada teléfono lo muestra un poco distinto.
            </p>
          </div>
        </div>

        {/*
          Lo que falta para que esto salga. Va arriba del botón y no escondido
          detrás: quien arma una campaña tiene que saberlo ANTES de
          escribirla.
        */}
        <div className="alert alert-amber" style={{ marginTop: 16 }}>
          <span>
            Todavía no se puede enviar. WhatsApp solo permite escribirle a
            alguien fuera de las 24 h con una plantilla aprobada por Meta, y eso
            está en desarrollo. Mientras tanto la campaña queda guardada.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="submit" className="btn btn-primary btn-sm">
            Guardar borrador
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled>
            Enviar campaña
          </button>
        </div>
      </aside>
    </form>
  )
}

/**
 * Elegir contactos a mano.
 *
 * Busca en el SERVIDOR y paginado. La otra opción era bajarse la lista entera
 * y filtrar en el navegador, que anda perfecto con las 30 filas de una cuenta
 * nueva y se cae con las 4.000 de un cliente de dos años. Justo el cliente
 * que más va a usar esto.
 *
 * Lo elegido se recuerda aunque cambie la búsqueda: si marcar tres, buscar
 * otra cosa y volver perdiera la selección, seleccionar cincuenta contactos
 * sería imposible.
 */
function Buscador({
  elegidos,
  setElegidos,
}: {
  elegidos: string[]
  setElegidos: (v: string[]) => void
}) {
  const [texto, setTexto] = useState('')
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<{
    filas: { id: string; nombre: string; telefono: string | null }[]
    total: number
    paginas: number
  }>({ filas: [], total: 0, paginas: 1 })
  const [cargando, empezar] = useTransition()

  useEffect(() => {
    const t = setTimeout(() => {
      empezar(async () => setDatos(await elegiblesPara(texto, pagina)))
    }, 300)
    return () => clearTimeout(t)
  }, [texto, pagina])

  return (
    <div style={{ marginTop: 14 }}>
      <input
        className="input"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          setPagina(1)
        }}
        placeholder="Buscar por nombre o teléfono…"
      />

      <p className="tiny muted" style={{ margin: '8px 0' }}>
        {elegidos.length} elegido{elegidos.length === 1 ? '' : 's'}
        {elegidos.length > 0 && (
          <>
            {' · '}
            <button
              type="button"
              className="enlace"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              onClick={() => setElegidos([])}
            >
              limpiar
            </button>
          </>
        )}
      </p>

      <div className="camp-lista">
        {cargando && datos.filas.length === 0 ? (
          <p className="tiny muted" style={{ margin: 0 }}>Buscando…</p>
        ) : datos.filas.length === 0 ? (
          <p className="tiny muted" style={{ margin: 0 }}>
            Ningún contacto con teléfono coincide.
          </p>
        ) : (
          datos.filas.map((c) => (
            <label key={c.id} className="camp-fila">
              <input
                type="checkbox"
                checked={elegidos.includes(c.id)}
                onChange={() =>
                  setElegidos(
                    elegidos.includes(c.id)
                      ? elegidos.filter((x) => x !== c.id)
                      : [...elegidos, c.id],
                  )
                }
              />
              <span>
                <strong style={{ fontSize: 13.5 }}>{c.nombre}</strong>
                <span className="tiny muted mono" style={{ display: 'block' }}>
                  {c.telefono}
                </span>
              </span>
            </label>
          ))
        )}
      </div>

      {datos.paginas > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={pagina <= 1}
            onClick={() => setPagina(pagina - 1)}
          >
            Anterior
          </button>
          <span className="tiny muted">
            {pagina} de {datos.paginas} · {datos.total} contactos
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={pagina >= datos.paginas}
            onClick={() => setPagina(pagina + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
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
