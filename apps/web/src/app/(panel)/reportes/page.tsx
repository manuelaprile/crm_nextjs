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
            <div className="lbl">{previa?.name ?? 'En seguimiento'}</div>
            <div className="val mono">{previa?.count ?? 0}</div>
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
                  De todas las que consultan, cuántas llegan a{' '}
                  {(previa?.name ?? 'la etapa siguiente').toLowerCase()} y
                  cuántas terminan en{' '}
                  {(ganada?.name ?? 'la etapa final').toLowerCase()}
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
  stages: { name: string; count: number; isWon: boolean }[],
): { name: string; count: number } | undefined {
  const i = stages.findIndex((x) => x.isWon)
  if (i > 0) return stages[i - 1]
  // Sin etapa ganadora definida, el hito del medio es lo mejor que hay.
  return stages.length > 2 ? stages[Math.floor(stages.length / 2)] : undefined
}
