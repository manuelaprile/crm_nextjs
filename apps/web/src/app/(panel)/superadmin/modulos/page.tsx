import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { estadoPorCuenta } from '@/lib/funciones'
import { MODULOS, buscarModulo } from '@/lib/modulos'
import { cambiarFuncionCuenta, funcionPorDefecto } from '@/lib/funciones-acciones'

export const dynamic = 'force-dynamic'

/**
 * Qué módulos tiene contratados cada cuenta.
 *
 * Pantalla aparte de Funciones a propósito, aunque compartan tabla y acciones:
 * una función es un interruptor de despliegue y se borra cuando la cosa está
 * probada; un módulo es lo que el cliente paga. El motivo largo está en
 * `lib/modulos.ts`.
 *
 * NO tiene el botón «prender en todas» que sí tiene Funciones. Ahí sirve —es
 * el final del despliegue gradual—; acá sería regalarle un módulo pago a
 * todos los clientes de un click, y no hay ningún caso en que eso sea lo que
 * alguien quiso hacer.
 */
export default async function ModulosPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; r?: string; m?: string }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { f, r, m } = await searchParams
  const elegido = (f && buscarModulo(f)) || MODULOS[0]
  const cuentas = elegido ? await estadoPorCuenta(elegido.codigo) : []
  const contratado = cuentas.filter((c) => c.explicito === true).length

  return (
    <>
      <div className="topnav">
        <h2>Módulos</h2>
        <span className="badge b-dark">Superadmin</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/superadmin" className="btn btn-ghost btn-sm">
            Cuentas
          </Link>
          <Link href="/superadmin/funciones" className="btn btn-ghost btn-sm">
            Funciones
          </Link>
          <Link href="/superadmin/usuarios" className="btn btn-ghost btn-sm">
            Usuarios
          </Link>
        </div>
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

        {!elegido ? (
          <div className="panel-box">
            <div className="empty">
              <b>Todavía no hay módulos</b>
              Se agregan desde el código, en lib/modulos.ts.
            </div>
          </div>
        ) : (
          <>
            {MODULOS.length > 1 && (
              <div className="toolbar">
                {MODULOS.map((mod) => (
                  <Link
                    key={mod.codigo}
                    href={`/superadmin/modulos?f=${mod.codigo}`}
                    className={`btn btn-sm ${
                      mod.codigo === elegido.codigo ? 'btn-primary' : 'btn-ghost'
                    }`}
                  >
                    {mod.nombre}
                  </Link>
                ))}
              </div>
            )}

            <div className="panel-box" style={{ marginBottom: 16 }}>
              <div className="panel-box-head">
                <h3>{elegido.nombre}</h3>
                <span className="badge b-gray mono">{elegido.codigo}</span>
                <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                  {contratado} de {cuentas.length} con el módulo
                </span>
              </div>
              <div className="panel-box-body">
                <p className="tiny muted" style={{ margin: 0, lineHeight: 1.5 }}>
                  {elegido.detalle}
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
                      <th>Módulo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuentas.map((c) => {
                      const activo =
                        c.explicito === null ? elegido.porDefecto : c.explicito
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
                              className={`badge ${activo ? 'b-green' : 'b-gray'}`}
                            >
                              {activo ? 'Contratado' : 'No contratado'}
                            </span>
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
                                <input type="hidden" name="codigo" value={elegido.codigo} />
                                <input type="hidden" name="tenantId" value={c.tenantId} />
                                <input type="hidden" name="nombre" value={c.nombre} />
                                <input
                                  type="hidden"
                                  name="activo"
                                  value={activo ? 'no' : 'si'}
                                />
                                <button
                                  type="submit"
                                  className={`btn btn-sm ${
                                    activo ? 'btn-ghost' : 'btn-primary'
                                  }`}
                                >
                                  {activo ? 'Quitar' : 'Dar de alta'}
                                </button>
                              </form>
                              {/* Volver al estado "nunca se tocó". Se ve solo
                                  si hay algo que borrar: en un módulo, «sin
                                  decisión» y «no contratado» se ven igual, y
                                  ofrecer un botón que no cambia nada confunde. */}
                              {c.explicito !== null && (
                                <form action={funcionPorDefecto}>
                                  <input type="hidden" name="codigo" value={elegido.codigo} />
                                  <input type="hidden" name="tenantId" value={c.tenantId} />
                                  <input type="hidden" name="nombre" value={c.nombre} />
                                  <button type="submit" className="btn btn-ghost btn-sm">
                                    Borrar decisión
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
          </>
        )}
      </div>
    </>
  )
}
