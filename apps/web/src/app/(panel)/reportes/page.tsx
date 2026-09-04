import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { getFunnelReport } from '@/lib/queries'

export const dynamic = 'force-dynamic'

/**
 * El recorte por fecha de ALTA del contacto.
 *
 * «Actual» va primero y sin días: son todos los contactos, sin recortar. Es
 * la vista que se compara contra el tablero —ahí tampoco hay recorte— y por
 * eso es la que abre. Con 30 días por defecto, un cliente con contactos más
 * viejos ve menos de los que tiene y parece que faltan.
 */
const RANGOS: { days: number | null; label: string }[] = [
  { days: null, label: 'Actual' },
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 365, label: 'Un año' },
]

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  const session = await requireTenant()
  const { dias } = await searchParams
  // Sin parámetro es «Actual». Un `dias` que no esté en la lista cae ahí
  // también: la URL la escribe cualquiera.
  const elegido = RANGOS.find((r) => r.days !== null && String(r.days) === dias)
  const days = elegido?.days ?? null
  const report = await getFunnelReport(session, days)
  const max = Math.max(...report.stages.map((s) => s.pasaron), 1)

  // Los rótulos salen del EMBUDO del cliente, no de una lista fija. En el
  // consultorio la etapa ganadora se llama "Se operó"; en una inmobiliaria,
  // "Cerró la operación". Hardcodear "Se operaron" acá rompía el reporte para
  // cualquier rubro que no fuera el médico.
  const ganada = report.stages.find((x) => x.isWon)
  const previa = etapaPrevia(report.stages)

  return (
    <>
      <div className="topnav">
        <h2>Reportes</h2>
      </div>

      <div className="content">
        <div className="toolbar">
          {RANGOS.map((r) => (
            <Link
              key={r.label}
              href={r.days === null ? '/reportes' : `/reportes?dias=${r.days}`}
              className={`btn btn-sm ${r.days === days ? 'btn-primary' : 'btn-ghost'}`}
            >
              {r.label}
            </Link>
          ))}
        </div>

        <div className="stats">
          <div className="stat">
            <div className="lbl">Consultas recibidas</div>
            <div className="val mono">{report.totals.contactos}</div>
          </div>
          <div className="stat">
            <div className="lbl">{previa?.name ?? 'En seguimiento'}</div>
            <div className="val mono">{previa?.pasaron ?? 0}</div>
          </div>
          <div className="stat">
            <div className="lbl">{ganada?.name ?? 'Cerradas'}</div>
            <div className="val mono">{report.totals.operados}</div>
          </div>
          <div className="stat">
            <div className="lbl">Conversión</div>
            <div className="val mono">{report.totals.conversion.toFixed(1)}%</div>
          </div>
        </div>

        <div className="cols2">
          <div className="panel-box">
            <div className="panel-box-head">
              <div>
                <h3>Embudo</h3>
                <p className="tiny muted" style={{ marginTop: 3 }}>
                  Cuántos pasaron por cada etapa, y cuántos están ahí hoy
                </p>
              </div>
            </div>
            <div className="panel-box-body">
              {/*
                Los DOS números por etapa.

                «Pasaron» es histórico y «ahora» es el tablero. Mostrar solo
                el primero fue lo que hizo que un cliente comparara el reporte
                con sus contactos y no le cerrara: son dos preguntas
                distintas, y si la pantalla enseña una sola, la diferencia
                parece un error.
              */}
              <div className="bar-cabecera">
                <span>Pasaron</span>
                <span>Ahora</span>
              </div>
              {report.stages.map((s) => (
                <div key={s.name} className="bar-row">
                  <div className="bar-top">
                    <span>{s.name}</span>
                    <span className="bar-nums">
                      <b className="mono">{s.pasaron}</b>
                      <i className="mono">{s.ahora}</i>
                    </span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${(s.pasaron / max) * 100}%`,
                        background: s.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-box">
            <div className="panel-box-head">
              <h3>Por zona</h3>
            </div>
            {report.byCity.length === 0 ? (
              <div className="empty">
                <b>Sin datos de zona</b>
                Cargá la ciudad en las fichas para ver este reporte.
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Zona</th>
                      <th style={{ textAlign: 'right' }}>Consultas</th>
                      <th style={{ textAlign: 'right' }}>{ganada?.name ?? 'Cerradas'}</th>
                      <th style={{ textAlign: 'right' }}>Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byCity.map((c) => (
                      <tr key={c.city}>
                        <td>{c.city}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{c.total}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                          {c.operados}
                        </td>
                        <td className="mono muted" style={{ textAlign: 'right' }}>
                          {c.total ? ((c.operados / c.total) * 100).toFixed(0) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * La etapa inmediatamente anterior a la ganadora: el hito del medio del
 * embudo. Es la que responde "de los que consultan, cuántos llegaron hasta
 * acá antes de cerrar".
 */
function etapaPrevia(
  stages: { name: string; pasaron: number; isWon: boolean }[],
): { name: string; pasaron: number } | undefined {
  const i = stages.findIndex((x) => x.isWon)
  if (i > 0) return stages[i - 1]
  // Sin etapa ganadora definida, el hito del medio es lo mejor que hay.
  return stages.length > 2 ? stages[Math.floor(stages.length / 2)] : undefined
}
