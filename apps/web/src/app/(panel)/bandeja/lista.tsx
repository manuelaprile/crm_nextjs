import Link from 'next/link'
import { listConversations } from '@/lib/queries'
import { IconSearch } from '@/components/icons'

/**
 * Columna izquierda de la bandeja: buscador, filtros y las conversaciones.
 *
 * La renderizan las DOS pantallas —la bandeja vacía y la de un chat abierto—
 * porque un layout de Next no recibe los parámetros de la query, y el
 * buscador y los filtros viven ahí. Es una consulta más por navegación, con
 * su índice; a cambio, la lista y el chat se ven siempre juntos, como en
 * WhatsApp Web.
 */
export async function ListaConversaciones({
  session,
  activa,
  q,
  atiende,
  pagina = 1,
}: {
  session: Parameters<typeof listConversations>[0]
  /** Id de la conversación abierta, para marcarla. */
  activa?: string
  q?: string
  atiende?: 'ia' | 'humano' | 'visita'
  pagina?: number
}) {
  const datos = await listConversations(session, {
    search: q,
    atiende,
    pagina,
    porPagina: 50,
  })

  const conFiltros = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (atiende) sp.set('atiende', atiende)
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) sp.delete(k)
      else sp.set(k, v)
    }
    const s = sp.toString()
    return s ? `/bandeja?${s}` : '/bandeja'
  }

  const FILTROS = [
    { valor: undefined, label: 'Todas' },
    { valor: 'ia' as const, label: 'IA' },
    { valor: 'humano' as const, label: 'Humano' },
    { valor: 'visita' as const, label: 'Visita' },
  ]

  return (
    <div className="wa-list">
      <div className="wa-list-head">
        <form action="/bandeja" className="searchbox">
          <IconSearch />
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar conversación…"
            autoComplete="off"
          />
          {atiende ? <input type="hidden" name="atiende" value={atiende} /> : null}
        </form>

        <div className="wa-filtros">
          {FILTROS.map((f) => (
            <Link
              key={f.label}
              href={conFiltros({ atiende: f.valor, p: undefined })}
              className={`chip${atiende === f.valor ? ' on' : ''}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="wa-convs">
        {datos.filas.length === 0 ? (
          <p className="tiny muted" style={{ padding: '22px 16px', margin: 0 }}>
            {q || atiende
              ? 'Ninguna conversación coincide con el filtro.'
              : 'Todavía no entró ninguna consulta.'}
          </p>
        ) : (
          datos.filas.map((c) => {
            const nombre = c.participantName ?? c.participantPhone ?? 'Sin nombre'
            return (
              <Link
                key={c.id}
                href={`/bandeja/${c.id}`}
                className={`wa-conv${c.id === activa ? ' on' : ''}`}
              >
                <span className="avatar">{iniciales(nombre)}</span>
                <span className="meta">
                  <span className="r1">
                    <span className="nm">{nombre}</span>
                    <span className="tm">{cuando(c.lastMessageAt)}</span>
                  </span>
                  <span className="lm">{c.lastBody ?? 'Sin mensajes'}</span>
                  <span className="wa-conv-tags">
                    {/*
                      "Humano" en ámbar y no en gris.
                      Que un hilo haya pasado a una persona es lo único de esta
                      lista que pide una acción: alguien está esperando que le
                      contesten. En gris se confundía con el resto y se pasaba
                      de largo.
                    */}
                    <span className={`badge ${c.aiEnabled ? 'b-blue' : 'b-amber'}`}>
                      {c.aiEnabled ? 'IA' : 'Humano'}
                    </span>
                    {c.proximoTurno ? (
                      <span className="badge b-green" title={cuandoViene(c.proximoTurno)}>
                        Visita {cuandoViene(c.proximoTurno)}
                      </span>
                    ) : null}
                    {c.unreadCount > 0 ? (
                      <span className="badge b-green">
                        {c.unreadCount} nuevo{c.unreadCount > 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </span>
                </span>
              </Link>
            )
          })
        )}
      </div>

      {datos.paginas > 1 ? (
        <div className="wa-list-foot">
          {pagina > 1 ? (
            <Link
              href={conFiltros({ p: String(pagina - 1) })}
              className="btn btn-ghost btn-sm"
            >
              Anteriores
            </Link>
          ) : (
            <span />
          )}
          <span className="tiny muted mono">
            {pagina}/{datos.paginas}
          </span>
          {pagina < datos.paginas ? (
            <Link
              href={conFiltros({ p: String(pagina + 1) })}
              className="btn btn-ghost btn-sm"
            >
              Siguientes
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  )
}

export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** Hora si es de hoy, día y mes si es más viejo. */
export function cuando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hoy = d.toDateString() === new Date().toDateString()
  return hoy
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

/**
 * Cuándo viene, en dos o tres palabras.
 *
 * La etiqueta de la lista tiene lugar para muy poco, y lo que se necesita de
 * un vistazo no es la fecha exacta sino si es hoy: eso cambia lo que hace la
 * persona que está mirando la bandeja.
 */
function cuandoViene(iso: string): string {
  const d = new Date(iso)
  const ahora = new Date()
  const dias = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime()) /
      86_400_000,
  )
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  if (dias === 0) return `hoy ${hora}`
  if (dias === 1) return `mañana ${hora}`
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}
