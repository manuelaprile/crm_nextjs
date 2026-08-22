import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { listConversations, getStages } from '@/lib/queries'
import { IconSearch } from '@/components/icons'
import { Paginacion } from '@/components/paginacion'

export const dynamic = 'force-dynamic'

export default async function BandejaPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    etapa?: string
    p?: string
    pp?: string
    filtro?: string
  }>
}) {
  const session = await requireTenant()
  const { q, etapa, p, pp, filtro } = await searchParams

  const porPagina = Number(pp) || 25
  const pagina = Number(p) || 1
  const soloNoLeidas = filtro === 'sin-leer'

  const [datos, stages] = await Promise.all([
    listConversations(session, {
      search: q,
      stageKey: etapa,
      pagina,
      porPagina,
      soloNoLeidas,
    }),
    getStages(session),
  ])

  // Conserva los filtros al saltar de página.
  const link = (n: number) => {
    const sp = new URLSearchParams({ p: String(n) })
    if (porPagina !== 25) sp.set('pp', String(porPagina))
    if (q) sp.set('q', q)
    if (etapa) sp.set('etapa', etapa)
    if (soloNoLeidas) sp.set('filtro', 'sin-leer')
    return `/bandeja?${sp.toString()}`
  }

  const hayFiltros = Boolean(q || etapa || soloNoLeidas || porPagina !== 25)

  return (
    <>
      <div className="topnav">
        <h2>Bandeja</h2>
        <span className="badge b-gray mono">{datos.total}</span>
      </div>

      <div className="content">
        <form className="toolbar" action="/bandeja">
          <div className="searchbox">
            <IconSearch />
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Buscar por nombre o teléfono…"
            />
          </div>
          <select
            name="etapa"
            defaultValue={etapa ?? ''}
            className="select"
            style={{ width: 'auto' }}
          >
            <option value="">Todas las etapas</option>
            {stages.map((s) => (
              <option key={s.id} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            name="pp"
            defaultValue={String(porPagina)}
            className="select"
            style={{ width: 'auto' }}
            aria-label="Conversaciones por página"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm">
            Aplicar
          </button>

          <Link
            href={soloNoLeidas ? '/bandeja' : '/bandeja?filtro=sin-leer'}
            className={`btn btn-sm ${soloNoLeidas ? 'btn-primary' : 'btn-ghost'}`}
          >
            Sin leer
          </Link>

          {hayFiltros && (
            <Link href="/bandeja" className="btn btn-ghost btn-sm">
              Limpiar
            </Link>
          )}
        </form>

        <div className="panel-box">
          {datos.total === 0 ? (
            <div className="empty">
              <b>
                {hayFiltros
                  ? 'Sin resultados'
                  : 'Todavía no entró ninguna consulta'}
              </b>
              {hayFiltros ? (
                'Probá con otro filtro.'
              ) : (
                <>
                  Cuando alguien escriba al WhatsApp del consultorio, la
                  conversación aparece acá.
                  <div style={{ marginTop: 16 }}>
                    <Link
                      href="/configuracion/whatsapp"
                      className="btn btn-ghost btn-sm"
                    >
                      Conectar WhatsApp
                    </Link>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Contacto</th>
                      <th>Último mensaje</th>
                      <th>Etapa</th>
                      <th>Atiende</th>
                      <th style={{ textAlign: 'right' }}>Cuándo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.filas.map((c) => (
                      <tr key={c.id} className="clickable">
                        <td>
                          <Link
                            href={`/bandeja/${c.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 11 }}
                          >
                            <span className="avatar">
                              {iniciales(
                                c.participantName ?? c.participantPhone ?? '?',
                              )}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span
                                style={{
                                  display: 'block',
                                  fontWeight: 600,
                                  fontSize: 13.5,
                                }}
                              >
                                {c.participantName ??
                                  c.participantPhone ??
                                  'Sin nombre'}
                              </span>
                              <span className="tiny muted mono">
                                {c.participantPhone ? `+${c.participantPhone}` : '—'}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td style={{ maxWidth: 340 }}>
                          <Link
                            href={`/bandeja/${c.id}`}
                            className="muted"
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {c.lastBody ?? 'Sin mensajes'}
                          </Link>
                        </td>
                        <td>
                          {c.stageName ? (
                            <span
                              className="badge badge-dot"
                              style={{
                                background: `${c.stageColor}1a`,
                                color: c.stageColor ?? undefined,
                              }}
                            >
                              {c.stageName}
                            </span>
                          ) : (
                            <span className="muted tiny">—</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge ${c.aiEnabled ? 'b-blue' : 'b-gray'}`}
                          >
                            {c.aiEnabled ? 'IA' : 'Humano'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span className="tiny muted mono">
                            {cuando(c.lastMessageAt)}
                          </span>
                          {c.unreadCount > 0 && (
                            <span
                              className="badge b-dark"
                              style={{ marginLeft: 8, padding: '2px 8px' }}
                            >
                              {c.unreadCount}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
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
            </>
          )}
        </div>
      </div>
    </>
  )
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function cuando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hoy = d.toDateString() === new Date().toDateString()
  return hoy
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}
