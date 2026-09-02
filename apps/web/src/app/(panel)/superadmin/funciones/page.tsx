import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { FUNCIONES, buscarFuncion, estadoPorCuenta } from '@/lib/funciones'
import {
  cambiarFuncionCuenta,
  funcionPorDefecto,
  cambiarFuncionTodas,
} from '@/lib/funciones-acciones'

export const dynamic = 'force-dynamic'

/**
 * Prender una función en una cuenta antes que en todas.
 *
 * Es lo más parecido a un despliegue gradual que permite esta arquitectura:
 * el código llega a todos al mismo tiempo, pero puede llegar apagado. La
 * lista de funciones sale del catálogo del código (`lib/funciones.ts`), así
 * que acá nunca aparece un interruptor que no apague nada.
 */
export default async function FuncionesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; r?: string; m?: string }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { f, r, m } = await searchParams
  const elegida = (f && buscarFuncion(f)) || FUNCIONES[0]
  const cuentas = elegida ? await estadoPorCuenta(elegida.codigo) : []

  const prendidas = cuentas.filter((c) =>
    c.explicito === null ? elegida!.porDefecto : c.explicito,
  ).length

  return (
    <>
      <div className="topnav">
        <h2>Funciones</h2>
        <span className="badge b-dark">Superadmin</span>
      </div>

      <div className="content">
        {m ? (
          <div
            className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
            style={{ marginBottom: 16 }}
          >
            <span>{m}</span>
          </div>
        ) : null}

        {!elegida ? (
          <div className="panel-box">
            <div className="empty">
              <b>No hay funciones con interruptor</b>
              Se agregan desde el código, en lib/funciones.ts.
            </div>
          </div>
        ) : (
          <>
            {FUNCIONES.length > 1 && (
              <div className="toolbar">
                {FUNCIONES.map((fn) => (
                  <Link
                    key={fn.codigo}
                    href={`/superadmin/funciones?f=${fn.codigo}`}
                    className={`btn btn-sm ${
                      fn.codigo === elegida.codigo ? 'btn-primary' : 'btn-ghost'
                    }`}
                  >
                    {fn.nombre}
                  </Link>
                ))}
              </div>
            )}

            <div className="panel-box" style={{ marginBottom: 16 }}>
              <div className="panel-box-head">
                <h3>{elegida.nombre}</h3>
                <span className="badge b-gray mono">{elegida.codigo}</span>
                <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                  {prendidas} de {cuentas.length} prendida
                  {prendidas === 1 ? '' : 's'}
                </span>
              </div>
              <div className="panel-box-body">
                <p className="tiny muted" style={{ margin: 0, lineHeight: 1.5 }}>
                  {elegida.detalle}
                </p>
                <p className="tiny muted" style={{ marginBottom: 0 }}>
                  Por defecto:{' '}
                  <strong>{elegida.porDefecto ? 'prendida' : 'apagada'}</strong>
                </p>
              </div>
            </div>

            <div className="panel-box" style={{ marginBottom: 16 }}>
              <div className="panel-box-head">
                <h3>Cuenta por cuenta</h3>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuentas.map((c) => {
                      const activa =
                        c.explicito === null ? elegida.porDefecto : c.explicito
                      return (
                        <tr key={c.tenantId}>
                          <td>
                            <span
                              style={{
                                display: 'block',
                                fontWeight: 600,
                                fontSize: 13.5,
                              }}
                            >
                              {c.nombre}
                            </span>
                            <span className="tiny muted mono">{c.slug}</span>
                          </td>
                          <td>
                            <span
                              className={`badge ${activa ? 'b-green' : 'b-gray'}`}
                            >
                              {activa ? 'Prendida' : 'Apagada'}
                            </span>
                            {c.explicito === null && (
                              <span
                                className="tiny muted"
                                style={{ marginLeft: 8 }}
                              >
                                por defecto
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div
                              style={{
                                display: 'flex',
                                gap: 8,
                                justifyContent: 'flex-end',
                              }}
                            >
                              <form action={cambiarFuncionCuenta}>
                                <input type="hidden" name="codigo" value={elegida.codigo} />
                                <input type="hidden" name="tenantId" value={c.tenantId} />
                                <input type="hidden" name="nombre" value={c.nombre} />
                                <input
                                  type="hidden"
                                  name="activo"
                                  value={activa ? 'no' : 'si'}
                                />
                                <button type="submit" className="btn btn-ghost btn-sm">
                                  {activa ? 'Apagar' : 'Prender'}
                                </button>
                              </form>
                              {c.explicito !== null && (
                                <form action={funcionPorDefecto}>
                                  <input type="hidden" name="codigo" value={elegida.codigo} />
                                  <input type="hidden" name="tenantId" value={c.tenantId} />
                                  <input type="hidden" name="nombre" value={c.nombre} />
                                  <button type="submit" className="btn btn-ghost btn-sm">
                                    Por defecto
                                  </button>
                                </form>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Aplicar en todas las cuentas</h3>
              </div>
              <div className="panel-box-body">
                <form
                  action={cambiarFuncionTodas}
                  style={{ display: 'grid', gap: 12, maxWidth: 460 }}
                >
                  <input type="hidden" name="codigo" value={elegida.codigo} />
                  <div className="field">
                    <label htmlFor="confirma">
                      Escribí <code>{elegida.codigo}</code> para confirmar
                    </label>
                    <input
                      id="confirma"
                      name="confirma"
                      className="input"
                      autoComplete="off"
                      placeholder={elegida.codigo}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="submit"
                      name="activo"
                      value="si"
                      className="btn btn-primary"
                    >
                      Prender en todas
                    </button>
                    <button
                      type="submit"
                      name="activo"
                      value="no"
                      className="btn btn-ghost"
                    >
                      Apagar en todas
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
