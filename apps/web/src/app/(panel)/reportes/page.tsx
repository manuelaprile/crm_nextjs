import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { getFunnelReport } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const RANGOS = [
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
  const days = RANGOS.some((r) => String(r.days) === dias) ? Number(dias) : 30
  const report = await getFunnelReport(session, days)
  const max = Math.max(...report.stages.map((s) => s.count), 1)

  return (
    <>
      <div className="topnav">
        <h2>Reportes</h2>
      </div>

      <div className="content">
        <div className="toolbar">
          {RANGOS.map((r) => (
            <Link
              key={r.days}
              href={`/reportes?dias=${r.days}`}
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
            <div className="lbl">Llegaron al consultorio</div>
            <div className="val mono">{visitaron(report)}</div>
          </div>
          <div className="stat">
            <div className="lbl">Se operaron</div>
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
                  De todas las que consultan, cuántas llegan al consultorio y
                  cuántas se operan
                </p>
              </div>
            </div>
            <div className="panel-box-body">
              {report.stages.map((s) => (
                <div key={s.name} className="bar-row">
                  <div className="bar-top">
                    <span>{s.name}</span>
                    <b className="mono">{s.count}</b>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${(s.count / max) * 100}%`,
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
                      <th style={{ textAlign: 'right' }}>Operados</th>
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

function visitaron(report: { stages: { name: string; count: number }[] }): number {
  const s = report.stages.find((x) => x.name.toLowerCase().includes('consultorio'))
  return s?.count ?? 0
}
