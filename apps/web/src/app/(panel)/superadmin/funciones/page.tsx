import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { FUNCIONES, estadoPorCuenta } from '@/lib/funciones'
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
 * lista sale del catálogo del código (`lib/funciones.ts`), así que acá nunca
 * aparece un interruptor que no apague nada.
 *
 * MISMA FORMA QUE MÓDULOS: cuentas en las filas, interruptores en las
 * columnas. Antes había que elegir una función arriba y recién ahí veías las
 * cuentas, así que «¿qué tiene prendido esta cuenta?» obligaba a recorrer
 * función por función y acordarse.
 *
 * LO QUE ACÁ NO ES IGUAL A MÓDULOS: la función tiene un VALOR POR DEFECTO, y
 * un módulo siempre arranca apagado. Entonces un interruptor prendido puede
 * significar dos cosas distintas —alguien lo prendió, o viene así— y la
 * diferencia importa: cambiar el valor por defecto en el código mueve a las
 * cuentas que nunca se tocaron, y no a las que sí.
 *
 * Eso NO se cuenta en la celda. Una etiqueta debajo del interruptor le
 * cambiaba el alto a la fila y la tabla quedaba despareja contra la de
 * Módulos. Va en el `title` del interruptor, en un punto al costado para el
 * que no pasa el mouse, y abajo la lista de cuentas que tienen una decisión
 * propia —con su botón para soltarla—, que normalmente está vacía.
 */
export default async function FuncionesPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { r, m } = await searchParams

  // Una consulta por función, no una por cuenta: son un puñado fijo, y al
  // revés serían tantas como clientes haya.
  const estados = await Promise.all(
    FUNCIONES.map(async (fn) => ({
      funcion: fn,
      cuentas: await estadoPorCuenta(fn.codigo),
    })),
  )
  const cuentas = estados[0]?.cuentas ?? []

  const celda = (codigo: string, tenantId: string) => {
    const e = estados.find((x) => x.funcion.codigo === codigo)!
    const c = e.cuentas.find((y) => y.tenantId === tenantId)
    const explicito = c?.explicito ?? null
    return {
      activa: explicito === null ? e.funcion.porDefecto : explicito,
      porDefecto: explicito === null,
    }
  }

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

        {FUNCIONES.length === 0 || cuentas.length === 0 ? (
          <div className="panel-box">
            <div className="empty">
              <b>
                {FUNCIONES.length === 0
                  ? 'No hay funciones con interruptor'
                  : 'Todavía no hay cuentas'}
              </b>
              {FUNCIONES.length === 0
                ? 'Se agregan desde el código, en lib/funciones.ts.'
                : 'Creá una cuenta y vas a poder prenderle funciones.'}
            </div>
          </div>
        ) : (
          <>
            <div className="panel-box" style={{ marginBottom: 16 }}>
              <div className="panel-box-head">
                <h3>Cuentas</h3>
                <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                  {cuentas.length} cuenta{cuentas.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      {FUNCIONES.map((fn) => (
                        <th
                          key={fn.codigo}
                          style={{ textAlign: 'center' }}
                          title={fn.detalle}
                        >
                          {fn.nombre}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cuentas.map((c) => (
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
                        {FUNCIONES.map((fn) => {
                          const { activa, porDefecto } = celda(fn.codigo, c.tenantId)
                          return (
                            <td key={fn.codigo} style={{ textAlign: 'center' }}>
                              <form action={cambiarFuncionCuenta}>
                                <input type="hidden" name="codigo" value={fn.codigo} />
                                <input type="hidden" name="tenantId" value={c.tenantId} />
                                <input type="hidden" name="nombre" value={c.nombre} />
                                <input
                                  type="hidden"
                                  name="activo"
                                  value={activa ? 'no' : 'si'}
                                />
                                {/*
                                  Solo el interruptor, como en Módulos. Que el
                                  valor sea el de fábrica o el que alguien
                                  eligió se dice en el `title` y con un punto
                                  al costado: una etiqueta debajo le cambiaba
                                  el alto a la fila y la tabla quedaba despareja.
                                */}
                                <button
                                  type="submit"
                                  role="switch"
                                  aria-checked={activa}
                                  aria-label={`${fn.nombre} en ${c.nombre}`}
                                  title={
                                    porDefecto
                                      ? `Viene ${activa ? 'prendida' : 'apagada'} de fábrica: nadie la tocó en esta cuenta`
                                      : `${activa ? 'Prendida' : 'Apagada'} a propósito en esta cuenta`
                                  }
                                  className={`switch${activa ? ' on' : ''}${
                                    porDefecto ? '' : ' decidido'
                                  }`}
                                >
                                  <span className="switch-bolita" />
                                </button>
                              </form>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Qué hace cada una, y los botones de "esto ya está probado".
                Van acá abajo y no arriba de la tabla: prender algo en TODAS
                las cuentas de un click no tiene que estar al lado del mouse
                mientras alguien prueba una cuenta suelta. */}
            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Qué hace cada función</h3>
              </div>
              <div className="panel-box-body" style={{ display: 'grid', gap: 16 }}>
                {FUNCIONES.map((fn) => (
                  <div key={fn.codigo}>
                    <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 13.5 }}>
                      {fn.nombre}
                    </p>
                    <p
                      className="tiny muted"
                      style={{ margin: '0 0 8px', lineHeight: 1.5 }}
                    >
                      {fn.detalle} Por defecto viene{' '}
                      <strong>{fn.porDefecto ? 'prendida' : 'apagada'}</strong>.
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <form action={cambiarFuncionTodas}>
                        <input type="hidden" name="codigo" value={fn.codigo} />
                        <input type="hidden" name="activo" value="si" />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Prender en todas
                        </button>
                      </form>
                      <form action={cambiarFuncionTodas}>
                        <input type="hidden" name="codigo" value={fn.codigo} />
                        <input type="hidden" name="activo" value="no" />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Apagar en todas
                        </button>
                      </form>
                    </div>

                    {/* Las cuentas con decisión propia. Solo aparece cuando
                        hay alguna: en el caso normal —nadie tocó nada— este
                        bloque no existe y no ensucia la pantalla. */}
                    {(() => {
                      const decididas =
                        estados
                          .find((x) => x.funcion.codigo === fn.codigo)
                          ?.cuentas.filter((c) => c.explicito !== null) ?? []
                      if (decididas.length === 0) return null
                      return (
                        <div style={{ marginTop: 10 }}>
                          <p className="tiny muted" style={{ margin: '0 0 4px' }}>
                            Con decisión propia (el resto sigue el valor por
                            defecto):
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {decididas.map((c) => (
                              <form
                                key={c.tenantId}
                                action={funcionPorDefecto}
                                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                              >
                                <input type="hidden" name="codigo" value={fn.codigo} />
                                <input type="hidden" name="tenantId" value={c.tenantId} />
                                <input type="hidden" name="nombre" value={c.nombre} />
                                <span className="badge b-gray">
                                  {c.nombre}: {c.explicito ? 'prendida' : 'apagada'}
                                </span>
                                <button
                                  type="submit"
                                  className="tiny enlace celda-soltar"
                                  title="Borrar la decisión y volver al valor por defecto"
                                >
                                  soltar
                                </button>
                              </form>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
