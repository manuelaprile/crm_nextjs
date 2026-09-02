import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { estadoPorCuenta } from '@/lib/funciones'
import { MODULOS } from '@/lib/modulos'
import { cambiarFuncionCuenta } from '@/lib/funciones-acciones'

export const dynamic = 'force-dynamic'

/**
 * Qué módulos tiene contratados cada cuenta.
 *
 * LAS CUENTAS SON LAS FILAS Y LOS MÓDULOS LAS COLUMNAS, con un interruptor en
 * cada cruce. Antes había que elegir un módulo arriba y recién ahí veías las
 * cuentas: para responder "¿qué tiene contratado Amengual?" —que es la
 * pregunta que uno se hace— había que entrar módulo por módulo y acordarse.
 * Así se lee de una fila.
 *
 * Pantalla aparte de Funciones aunque compartan tabla y acciones: una función
 * es un interruptor de despliegue y se borra cuando la cosa está probada; un
 * módulo es lo que el cliente paga. El motivo largo está en `lib/modulos.ts`.
 *
 * NO tiene el botón «prender en todas» que sí tiene Funciones. Ahí sirve —es
 * el final del despliegue gradual—; acá sería regalarle un módulo pago a
 * todos los clientes de un click.
 */
export default async function ModulosPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { r, m } = await searchParams

  // Una consulta por módulo, no una por cuenta. Con dos o tres módulos son
  // dos o tres consultas fijas; al revés serían tantas como clientes haya.
  const estados = await Promise.all(
    MODULOS.map(async (mod) => ({
      modulo: mod,
      cuentas: await estadoPorCuenta(mod.codigo),
    })),
  )

  // Las cuentas salen de la primera consulta: todas devuelven la misma lista.
  const cuentas = estados[0]?.cuentas ?? []
  const activo = (codigo: string, tenantId: string) => {
    const e = estados.find((x) => x.modulo.codigo === codigo)
    const c = e?.cuentas.find((y) => y.tenantId === tenantId)
    return c?.explicito === null || c === undefined
      ? (e?.modulo.porDefecto ?? false)
      : c.explicito
  }

  return (
    <>
      <div className="topnav">
        <h2>Módulos</h2>
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

        {MODULOS.length === 0 || cuentas.length === 0 ? (
          <div className="panel-box">
            <div className="empty">
              <b>
                {MODULOS.length === 0
                  ? 'Todavía no hay módulos'
                  : 'Todavía no hay cuentas'}
              </b>
              {MODULOS.length === 0
                ? 'Se agregan desde el código, en lib/modulos.ts.'
                : 'Creá una cuenta y vas a poder darle módulos.'}
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
                      {MODULOS.map((mod) => (
                        <th
                          key={mod.codigo}
                          style={{ textAlign: 'center' }}
                          title={mod.detalle}
                        >
                          {mod.nombre}
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
                        {MODULOS.map((mod) => {
                          const on = activo(mod.codigo, c.tenantId)
                          return (
                            <td key={mod.codigo} style={{ textAlign: 'center' }}>
                              {/*
                                El interruptor es un `button` adentro de un
                                formulario, no un checkbox con JavaScript: así
                                anda igual sin hidratar, y el cambio pasa por
                                la misma función `security definer` que
                                verifica que quien lo toca sea superadmin.
                              */}
                              <form action={cambiarFuncionCuenta}>
                                <input type="hidden" name="codigo" value={mod.codigo} />
                                <input type="hidden" name="tenantId" value={c.tenantId} />
                                <input type="hidden" name="nombre" value={c.nombre} />
                                <input
                                  type="hidden"
                                  name="activo"
                                  value={on ? 'no' : 'si'}
                                />
                                <button
                                  type="submit"
                                  role="switch"
                                  aria-checked={on}
                                  aria-label={`${mod.nombre} en ${c.nombre}`}
                                  className={`switch${on ? ' on' : ''}`}
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

            {/* Qué hace cada módulo. Va abajo y no en un tooltip solamente:
                quien decide darle Campañas a un cliente tiene que poder leer
                qué le está dando sin adivinar. */}
            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Qué incluye cada módulo</h3>
              </div>
              <div className="panel-box-body" style={{ display: 'grid', gap: 12 }}>
                {MODULOS.map((mod) => (
                  <div key={mod.codigo}>
                    <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 13.5 }}>
                      {mod.nombre}
                    </p>
                    <p className="tiny muted" style={{ margin: 0, lineHeight: 1.5 }}>
                      {mod.detalle}
                    </p>
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
