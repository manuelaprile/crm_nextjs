import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { listarConsultorios } from '@/lib/usuarios'
import { IconSearch } from '@/components/icons'
import { Paginacion } from '@/components/paginacion'

export const dynamic = 'force-dynamic'

/**
 * Vista global de la plataforma. Solo superadmin.
 *
 * Muestra NÚMEROS, no datos. El superadmin ve cuántos contactos tiene cada
 * consultorio y cuánto gastó de IA, pero no puede leer un solo mensaje ni un
 * nombre de paciente: eso lo garantiza RLS, no esta pantalla. Ver el
 * comentario de 0010_superadmin.sql.
 */
export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; pp?: string }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { q, p, pp } = await searchParams
  const porPagina = Number(pp) || 25
  const datos = await listarConsultorios({
    pagina: Number(p) || 1,
    porPagina,
    buscar: q,
  })
  const consultorios = datos.filas
  // El total de IA es de la página visible, no de toda la plataforma: dejarlo
  // ambiguo sería peor que decirlo.
  const totalIa = consultorios.reduce((a, c) => a + Number(c.costoIaMes), 0)

  const link = (n: number) => {
    const sp = new URLSearchParams({ p: String(n) })
    if (porPagina !== 25) sp.set('pp', String(porPagina))
    if (q) sp.set('q', q)
    return `/superadmin?${sp.toString()}`
  }

  return (
    <>
      <div className="topnav">
        <h2>Plataforma</h2>
        <span className="badge b-dark">Superadmin</span>
      </div>

      <div className="content">
        <div className="stats">
          <div className="stat">
            <div className="lbl">Consultorios</div>
            <div className="val mono">{datos.total}</div>
          </div>
          <div className="stat">
            <div className="lbl">Activos</div>
            <div className="val mono">
              {consultorios.filter((c) => c.status === 'active').length}
            </div>
          </div>
          <div className="stat">
            <div className="lbl">Contactos totales</div>
            <div className="val mono">
              {consultorios.reduce((a, c) => a + c.contactos, 0)}
            </div>
          </div>
          <div className="stat">
            <div className="lbl">IA este mes</div>
            <div className="val mono">USD {totalIa.toFixed(2)}</div>
            <div className="delta muted" style={{ fontWeight: 500 }}>
              de esta página
            </div>
          </div>
        </div>

        <form className="toolbar" action="/superadmin">
          <div className="searchbox">
            <IconSearch />
            <input name="q" defaultValue={q ?? ''} placeholder="Buscar por nombre o slug…" />
          </div>
          <select
            name="pp"
            defaultValue={String(porPagina)}
            className="select"
            style={{ width: 'auto' }}
            aria-label="Consultorios por página"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} por página</option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
        </form>

        <div className="panel-box">
          <div className="panel-box-head">
            <h3>Consultorios</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Consultorio</th>
                  <th>Vertical</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Usuarios</th>
                  <th style={{ textAlign: 'right' }}>Contactos</th>
                  <th style={{ textAlign: 'right' }}>Conversaciones</th>
                  <th style={{ textAlign: 'right' }}>IA mes</th>
                </tr>
              </thead>
              <tbody>
                {consultorios.map((c) => {
                  const gasto = Number(c.costoIaMes)
                  const tope = Number(c.topeIa)
                  const cerca = tope > 0 && gasto / tope > 0.8
                  return (
                    <tr key={c.id}>
                      <td>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                          {c.name}
                        </span>
                        <span className="tiny muted mono">{c.slug}</span>
                      </td>
                      <td className="muted">{c.vertical}</td>
                      <td>
                        <span
                          className={`badge ${
                            c.status === 'active'
                              ? 'b-green'
                              : c.status === 'trial'
                                ? 'b-blue'
                                : 'b-red'
                          } badge-dot`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.usuarios}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.contactos}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {c.conversaciones}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: 'right',
                          color: cerca ? 'var(--c-danger)' : undefined,
                          fontWeight: cerca ? 600 : undefined,
                        }}
                      >
                        {gasto.toFixed(2)} / {tope.toFixed(0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Paginacion
            pagina={datos.pagina}
            paginas={datos.paginas}
            total={datos.total}
            porPagina={datos.porPagina}
            href={link}
          />
        </div>

        <div className="alert alert-gray" style={{ marginTop: 16 }}>
          <span>
            Esta pantalla muestra solo números agregados. Para entrar a un
            consultorio y dar soporte, hay que asignarse como usuario de ese
            consultorio — y eso queda registrado. No hay puerta trasera a los
            datos de los pacientes.
          </span>
        </div>
      </div>
    </>
  )
}
