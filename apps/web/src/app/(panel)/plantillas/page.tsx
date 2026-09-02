import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { moduloActivo } from '@/lib/modulos'
import { plantillasDeLaCuenta } from '@/lib/plantillas'
import { FormularioPlantilla } from './formulario'

export const dynamic = 'force-dynamic'

/**
 * Las plantillas de mensaje del negocio.
 *
 * Va bajo el módulo Campañas, no bajo uno propio: sin plantillas aprobadas
 * Campañas no manda nada, y sin campañas las plantillas no sirven. El
 * `notFound()` es la puerta de verdad; que el ítem no esté en el menú es
 * prolijidad.
 *
 * El estado lo dice Meta y se lee en el momento. No se guarda de este lado:
 * una plantilla puede aprobarse o rechazarse sin que nadie acá se entere, y
 * una copia local mostraría un texto distinto del que sale.
 */
export default async function PlantillasPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  if (!(await moduloActivo('modulo-campanas', session.tenantId))) notFound()

  const { r, m } = await searchParams
  const estado = await plantillasDeLaCuenta()

  return (
    <>
      <div className="topnav">
        <h2>Plantillas</h2>
        {estado.ok && (
          <span className="badge b-gray mono">{estado.plantillas.length}</span>
        )}
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

        {!estado.ok && estado.motivo === 'sin-numero' ? (
          <div className="panel-box">
            <div className="empty">
              <b>Falta conectar el número</b>
              Las plantillas viven en la cuenta de WhatsApp del negocio, así que
              primero hay que conectarla desde Configuración → WhatsApp.
            </div>
          </div>
        ) : (
          <>
            <div className="panel-box" style={{ marginBottom: 16 }}>
              <div className="panel-box-head">
                <h3>Nueva plantilla</h3>
              </div>
              <div className="panel-box-body">
                <FormularioPlantilla />
              </div>
            </div>

            {/*
              Las tres cosas que hacen que Meta rechace una plantilla, dichas
              ANTES de escribirla. El rechazo tarda horas en volver, así que
              enterarse después sale caro en tiempo.
            */}
            <div className="panel-box" style={{ marginBottom: 16 }}>
              <div className="panel-box-head">
                <h3>Antes de escribirla</h3>
              </div>
              <div className="panel-box-body">
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  <li>
                    Meta la revisa antes de que se pueda usar. Suele tardar entre
                    unos minutos y un día.
                  </li>
                  <li>
                    Los datos que cambian en cada envío van como huecos:{' '}
                    <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>. Tienen que ir
                    en orden y sin saltos.
                  </li>
                  <li>
                    El texto sale <strong>tal cual se aprueba</strong>. Para
                    cambiarlo hay que crear otra plantilla y esperar de nuevo.
                  </li>
                  <li>
                    Los envíos de una campaña los cobra Meta a la cuenta del
                    negocio, por mensaje entregado.
                  </li>
                </ul>
              </div>
            </div>

            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Tus plantillas</h3>
              </div>
              {!estado.ok ? (
                <div className="empty">
                  <b>No se pudieron leer</b>
                  {estado.detalle ?? 'Probá de nuevo en un momento.'}
                </div>
              ) : estado.plantillas.length === 0 ? (
                <div className="empty">
                  <b>Todavía no hay ninguna</b>
                  Creá la primera con el formulario de arriba.
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Plantilla</th>
                        <th>Texto</th>
                        <th style={{ textAlign: 'center' }}>Datos</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estado.plantillas.map((p) => (
                        <tr key={`${p.nombre}-${p.idioma}`}>
                          <td>
                            <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                              {p.nombre}
                            </span>
                            <span className="tiny muted mono">{p.idioma}</span>
                          </td>
                          <td style={{ maxWidth: 380 }}>
                            {p.conImagen && (
                              <span
                                className="badge b-blue"
                                style={{ marginBottom: 4 }}
                              >
                                Con imagen
                              </span>
                            )}
                            <span
                              className="tiny"
                              style={{ display: 'block', lineHeight: 1.5 }}
                            >
                              {p.cuerpo}
                            </span>
                            {p.motivoRechazo && (
                              <span
                                className="tiny"
                                style={{ display: 'block', color: 'var(--c-danger)', marginTop: 4 }}
                              >
                                {p.motivoRechazo}
                              </span>
                            )}
                          </td>
                          <td className="mono" style={{ textAlign: 'center' }}>
                            {p.huecos}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                p.estado === 'APPROVED'
                                  ? 'b-green'
                                  : p.estado === 'REJECTED'
                                    ? 'b-red'
                                    : 'b-amber'
                              }`}
                            >
                              {p.estado === 'APPROVED'
                                ? 'Aprobada'
                                : p.estado === 'REJECTED'
                                  ? 'Rechazada'
                                  : 'Pendiente'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
