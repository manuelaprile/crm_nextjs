import Link from 'next/link'
import { listConversations } from '@/lib/queries'
import { usuariosDeLaCuenta } from '@/lib/asignacion'
import { IconSearch } from '@/components/icons'
import { cuandoViene, horaOFecha } from '@/lib/fechas'

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
  zona,
  activa,
  q,
  atiende,
  usuario,
  pagina = 1,
}: {
  session: Parameters<typeof listConversations>[0]
  /**
   * La zona de la cuenta, para dibujar las horas.
   *
   * Viaja como prop y no sale de `session` porque acá `session` es el
   * contexto de la base —tenantId, userId, role— y no la sesión completa.
   */
  zona: string
  /** Id de la conversación abierta, para marcarla. */
  activa?: string
  q?: string
  atiende?: 'ia' | 'humano' | 'visita'
  /** Id del responsable, o 'sin' para las que no tiene nadie. */
  usuario?: string
  pagina?: number
}) {
  const [datos, usuarios] = await Promise.all([
    listConversations(session, {
      search: q,
      atiende,
      asignado: usuario,
      pagina,
      porPagina: 50,
    }),
    usuariosDeLaCuenta(session),
  ])

  const elegido = usuario ? usuarios.find((u) => u.id === usuario) : undefined
  const rotuloQuien =
    usuario === 'sin' ? 'Sin asignar' : (elegido?.nombre ?? 'Todos')

  const conFiltros = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (atiende) sp.set('atiende', atiende)
    if (usuario) sp.set('usuario', usuario)
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
          {usuario ? <input type="hidden" name="usuario" value={usuario} /> : null}
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

          {/*
            Quién la tiene a cargo es una pregunta distinta de quién la
            atiende —una persona puede ser responsable de un hilo que hoy
            contesta la IA—, así que es un filtro aparte y se combina con el
            de arriba. Va como desplegable y no como una chip por usuario:
            con cinco empleados la fila de solapas ya no entra.

            `<details>` y no un componente de cliente: el navegador ya sabe
            abrir y cerrar esto, y así la lista entera sigue siendo servidor.
          */}
          <details className="wa-quien">
            <summary className={`chip${usuario ? ' on' : ''}`}>
              Responsable: {rotuloQuien}
            </summary>
            <div className="wa-quien-panel">
              <Link href={conFiltros({ usuario: undefined, p: undefined })}>
                Todos
              </Link>
              <Link href={conFiltros({ usuario: 'sin', p: undefined })}>
                Sin asignar
              </Link>
              {usuarios.map((u) => (
                <Link
                  key={u.id}
                  href={conFiltros({ usuario: u.id, p: undefined })}
                >
                  {u.nombre}
                  {u.deshabilitado ? ' (sin acceso)' : ''}
                </Link>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div className="wa-convs">
        {datos.filas.length === 0 ? (
          <p className="tiny muted" style={{ padding: '22px 16px', margin: 0 }}>
            {q || atiende || usuario
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
                    <span className="tm">{horaOFecha(c.lastMessageAt, zona)}</span>
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
                    {c.asignadoNombre ? (
                      <span className="badge b-gray" title={`A cargo de ${c.asignadoNombre}`}>
                        {nombrePila(c.asignadoNombre)}
                      </span>
                    ) : null}
                    {c.proximoTurno ? (
                      <span className="badge b-green" title={cuandoViene(c.proximoTurno, zona)}>
                        Visita {cuandoViene(c.proximoTurno, zona)}
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

/** "María Laura Gómez" -> "María". En la lista no entra el nombre entero. */
function nombrePila(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre
}

export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
