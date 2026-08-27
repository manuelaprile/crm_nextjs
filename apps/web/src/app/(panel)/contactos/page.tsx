import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { etiquetaDe, delRubro, type Etiqueta } from '@/lib/etiquetas'
import { getPipeline, getStages, listContacts } from '@/lib/queries'
import { IconSearch } from '@/components/icons'
import { Board } from './board'
import { Paginacion } from '@/components/paginacion'
import { fecha } from '@/lib/fechas'

export const dynamic = 'force-dynamic'

/**
 * Dos vistas del mismo embudo:
 *
 * - **Tablero**: cómodo para arrastrar y ver el embudo de un vistazo, pero
 *   no escala. Muestra hasta 25 tarjetas por columna y avisa cuántas quedan.
 * - **Lista**: tabla paginada con búsqueda, filtro por etapa y cantidad de
 *   filas configurable. Todo resuelto en la base, no en el navegador.
 *
 * Desde 30 contactos la lista es la vista por defecto. La elección queda en
 * la URL, así que si preferís el tablero, el link te lo deja fijo.
 */
export default async function ContactosPage({
  searchParams,
}: {
  searchParams: Promise<{
    ver?: string
    vista?: string
    q?: string
    etapa?: string
    p?: string
    pp?: string
  }>
}) {
  const session = await requireTenant()
  const etiqueta = etiquetaDe(session)
  const { ver, vista, q, etapa, p, pp } = await searchParams
  const archivados = ver === 'archivados'

  const stages = await getStages(session)

  // Un conteo barato para decidir la vista por defecto.
  const sonda = await listContacts(session, { porPagina: 10, archivados })
  // A partir de 30 contactos la lista pasa a ser la vista por defecto: el
  // tablero deja de ser cómodo y hay que empezar a buscar en vez de mirar.
  const vistaEfectiva = vista ?? (sonda.total >= 30 ? 'lista' : 'tablero')
  const esLista = vistaEfectiva === 'lista'

  const qs = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    if (archivados) sp.set('ver', 'archivados')
    if (vista) sp.set('vista', vista)
    if (q) sp.set('q', q)
    if (etapa) sp.set('etapa', etapa)
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) sp.delete(k)
      else sp.set(k, v)
    }
    const s = sp.toString()
    return s ? `/contactos?${s}` : '/contactos'
  }

  return (
    <>
      <div className="topnav">
        <h2>Contactos</h2>
        <span className="badge b-gray mono">{sonda.total}</span>
        {archivados && <span className="badge b-amber">Archivados</span>}
      </div>

      <div className="content">
        <div className="toolbar">
          <Link
            href={qs({ vista: 'tablero', p: undefined })}
            className={`btn btn-sm ${esLista ? 'btn-ghost' : 'btn-primary'}`}
          >
            Tablero
          </Link>
          <Link
            href={qs({ vista: 'lista', p: undefined })}
            className={`btn btn-sm ${esLista ? 'btn-primary' : 'btn-ghost'}`}
          >
            Lista
          </Link>

          <span
            style={{
              width: 1,
              height: 22,
              background: 'var(--c-border)',
              margin: '0 4px',
            }}
          />

          <Link
            href={archivados ? '/contactos' : '/contactos?ver=archivados'}
            className="btn btn-ghost btn-sm"
          >
            {archivados ? 'Ver activos' : 'Ver archivados'}
          </Link>
        </div>

        {esLista ? (
          <ListaContactos
            session={session}
            zona={session.tenantZona}
            stages={stages}
            archivados={archivados}
            q={q}
            etapa={etapa}
            pagina={Number(p) || 1}
            porPagina={Number(pp) || 25}
          />
        ) : (
          <TableroContactos
            session={session}
            archivados={archivados}
            etiqueta={etiqueta}
          />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------

async function TableroContactos({
  session,
  archivados,
  etiqueta,
}: {
  session: Parameters<typeof getPipeline>[0]
  archivados: boolean
  etiqueta: Etiqueta
}) {
  const columns = await getPipeline(session, { archivados })
  const total = columns.reduce((a, c) => a + c.total, 0)
  const recortado = columns.some((c) => c.total > c.contacts.length)

  if (total === 0) {
    return (
      <div className="panel-box">
        <div className="empty">
          <b>
            {archivados
              ? 'No hay contactos archivados'
              : 'Todavía no hay contactos'}
          </b>
          {archivados
            ? 'Cuando archives a alguien desde su ficha, va a aparecer acá.'
            : `Cuando alguien escriba al WhatsApp ${delRubro(etiqueta)}, aparece acá.`}
        </div>
      </div>
    )
  }

  return (
    <>
      <p className="tiny muted" style={{ marginBottom: 10 }}>
        Arrastrá las tarjetas para cambiar de etapa · 25 por columna
      </p>
      <Board
        columns={columns.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          total: c.total,
          contacts: c.contacts,
        }))}
      />
    </>
  )
}

// ---------------------------------------------------------------------

async function ListaContactos({
  zona,
  session,
  stages,
  archivados,
  q,
  etapa,
  pagina,
  porPagina,
}: {
  session: Parameters<typeof listContacts>[0]
  /** La zona de la cuenta: acá `session` es el contexto de la base. */
  zona: string
  stages: Awaited<ReturnType<typeof getStages>>
  archivados: boolean
  q?: string
  etapa?: string
  pagina: number
  porPagina: number
}) {
  const datos = await listContacts(session, {
    pagina,
    porPagina,
    buscar: q,
    etapa,
    archivados,
  })

  // Conserva filtros y cantidad por página al saltar de página.
  const link = (p: number) => {
    const sp = new URLSearchParams({ vista: 'lista', p: String(p) })
    if (datos.porPagina !== 25) sp.set('pp', String(datos.porPagina))
    if (archivados) sp.set('ver', 'archivados')
    if (q) sp.set('q', q)
    if (etapa) sp.set('etapa', etapa)
    return `/contactos?${sp.toString()}`
  }

  return (
    <>
      <form className="toolbar" action="/contactos">
        <input type="hidden" name="vista" value="lista" />
        {archivados && <input type="hidden" name="ver" value="archivados" />}
        <div className="searchbox">
          <IconSearch />
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por nombre, teléfono o zona…"
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
          aria-label="Contactos por página"
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
        {(q || etapa || porPagina !== 25) && (
          <Link
            href={archivados ? '/contactos?vista=lista&ver=archivados' : '/contactos?vista=lista'}
            className="btn btn-ghost btn-sm"
          >
            Limpiar
          </Link>
        )}
      </form>

      <div className="panel-box">
        {datos.total === 0 ? (
          <div className="empty">
            <b>Sin resultados</b>
            {q || etapa
              ? 'Probá con otro filtro.'
              : 'Todavía no hay contactos acá.'}
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Contacto</th>
                    <th>Zona</th>
                    <th>Etapa</th>
                    <th style={{ textAlign: 'right' }}>Última actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.filas.map((c) => (
                    <tr key={c.id} className="clickable">
                      <td>
                        <Link href={`/contactos/${c.id}`}>
                          <span
                            style={{
                              display: 'block',
                              fontWeight: 600,
                              fontSize: 13.5,
                            }}
                          >
                            {c.displayName}
                          </span>
                          <span className="tiny muted mono">
                            {c.phone ? `+${c.phone}` : '—'}
                          </span>
                        </Link>
                      </td>
                      <td className="muted">{c.city ?? '—'}</td>
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
                      <td
                        className="tiny muted mono"
                        style={{ textAlign: 'right', whiteSpace: 'nowrap' }}
                      >
                        {c.lastActivityAt
                          ? fecha(c.lastActivityAt, zona)
                          : '—'}
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
    </>
  )
}
