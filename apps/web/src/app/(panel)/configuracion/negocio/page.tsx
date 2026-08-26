import { requireTenant } from '@/lib/auth'
import { conocimientoDelNegocio } from '@/lib/conocimiento'
import {
  guardarEntrada,
  alternarEntrada,
  borrarEntrada,
} from '@/lib/conocimiento-acciones'

export const dynamic = 'force-dynamic'

/** Después de cuántos días una entrada se marca como que conviene revisarla. */
const DIAS_PARA_REVISAR = 120

/**
 * Lo que el asistente sabe del negocio.
 *
 * Cada entrada acá es una pregunta que el asistente deja de derivar. El caso
 * que originó esta pantalla fue literal: derivaba a una persona porque le
 * preguntaban precios y no había ningún lado donde cargarlos.
 */
export default async function NegocioPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string; editar?: string }>
}) {
  const session = await requireTenant()
  const { r, m, editar } = await searchParams
  const entradas = await conocimientoDelNegocio(session.tenantId)
  const puedeEditar = session.role !== 'agent'
  const enEdicion = entradas.find((e) => e.id === editar)

  const viejas = entradas.filter(
    (e) =>
      e.activo &&
      Date.now() - new Date(e.actualizadoEn).getTime() >
        DIAS_PARA_REVISAR * 24 * 60 * 60 * 1000,
  ).length

  return (
    <>
      {m ? (
        <div
          className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
          style={{ marginBottom: 16 }}
        >
          <span>{m}</span>
        </div>
      ) : null}

      <div className="page-head">
        <p style={{ marginTop: 0 }}>
          Lo que el asistente puede responder sin derivar
        </p>
      </div>

      {viejas > 0 && (
        <div className="alert alert-amber" style={{ marginBottom: 16 }}>
          <span>
            {viejas} entrada{viejas === 1 ? '' : 's'} sin actualizar hace más de{' '}
            {DIAS_PARA_REVISAR} días.
          </span>
        </div>
      )}

      {puedeEditar && (
        <div className="panel-box" style={{ marginBottom: 16 }}>
          <div className="panel-box-head">
            <h3>{enEdicion ? 'Editar entrada' : 'Agregar información'}</h3>
          </div>
          <div className="panel-box-body">
            <form action={guardarEntrada} style={{ display: 'grid', gap: 12 }}>
              {enEdicion && (
                <input type="hidden" name="id" value={enEdicion.id} />
              )}
              <div className="field">
                <label htmlFor="titulo">Tema</label>
                <input
                  id="titulo"
                  name="titulo"
                  className="input"
                  defaultValue={enEdicion?.titulo ?? ''}
                  placeholder="Precios, Horarios de atención, Cómo llegar…"
                  maxLength={80}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="contenido">Qué tiene que saber</label>
                <textarea
                  id="contenido"
                  name="contenido"
                  className="input"
                  rows={7}
                  defaultValue={enEdicion?.contenido ?? ''}
                  placeholder={
                    'Consulta: $30.000\nControl posterior: sin cargo dentro de los 30 días\nNo trabajamos con obras sociales.'
                  }
                  maxLength={4000}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary">
                  {enEdicion ? 'Guardar cambios' : 'Agregar'}
                </button>
                {enEdicion && (
                  <a href="/configuracion/negocio" className="btn btn-ghost">
                    Cancelar
                  </a>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="panel-box">
        <div className="panel-box-head">
          <h3>Información cargada</h3>
        </div>
        <div className="panel-box-body">
          {entradas.length === 0 ? (
            <div className="empty">
              <b>Todavía no cargaste nada</b>
              Empezá por lo que más te preguntan: precios, horarios, dirección.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {entradas.map((e) => (
                <div
                  key={e.id}
                  style={{
                    border: '1px solid var(--c-border)',
                    borderRadius: 'var(--r-md)',
                    padding: 14,
                    opacity: e.activo ? 1 : 0.55,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      marginBottom: 6,
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>{e.titulo}</strong>
                    {!e.activo && (
                      <span className="badge b-gray">Sin usar</span>
                    )}
                    <span
                      className="tiny muted"
                      style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
                    >
                      {new Date(e.actualizadoEn).toLocaleDateString('es-AR')}
                    </span>
                  </div>
                  <p
                    className="tiny"
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      color: 'var(--c-muted)',
                      lineHeight: 1.5,
                    }}
                  >
                    {e.contenido}
                  </p>
                  {puedeEditar && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <a
                        href={`/configuracion/negocio?editar=${e.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Editar
                      </a>
                      <form action={alternarEntrada}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          {e.activo ? 'Dejar de usar' : 'Volver a usar'}
                        </button>
                      </form>
                      <form action={borrarEntrada} style={{ marginLeft: 'auto' }}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="titulo" value={e.titulo} />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Borrar
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </>
  )
}
