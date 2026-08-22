import Link from 'next/link'

/**
 * Paginación numerada.
 *
 * Con muchas páginas no se pueden listar todas: se muestra la primera, la
 * última, la actual y dos a cada lado, con puntos suspensivos en los saltos.
 * Es el patrón que ya conocés de phpMyAdmin y de WordPress.
 *
 * Son links `<a>`, no botones con JavaScript: se pueden abrir en otra
 * pestaña, quedan en el historial del navegador y funcionan aunque el JS
 * falle.
 */
export function Paginacion({
  pagina,
  paginas,
  total,
  porPagina,
  href,
}: {
  pagina: number
  paginas: number
  total: number
  porPagina: number
  /** Arma la URL de una página dada, conservando filtros. */
  href: (p: number) => string
}) {
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '13px 18px',
        borderTop: '1px solid var(--c-border)',
        flexWrap: 'wrap',
      }}
    >
      <span className="tiny muted mono">
        {desde}–{hasta} de {total}
      </span>

      {paginas > 1 && (
        <nav
          aria-label="Paginación"
          style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}
        >
          <Flecha
            href={href(pagina - 1)}
            activo={pagina > 1}
            label="Página anterior"
          >
            ←
          </Flecha>

          {numeros(pagina, paginas).map((n, i) =>
            n === null ? (
              <span
                key={`e${i}`}
                className="tiny muted"
                style={{ padding: '7px 4px', userSelect: 'none' }}
              >
                …
              </span>
            ) : (
              <Link
                key={n}
                href={href(n)}
                aria-current={n === pagina ? 'page' : undefined}
                className={`btn btn-sm mono ${n === pagina ? 'btn-primary' : 'btn-ghost'}`}
                style={{ minWidth: 34, padding: '7px 9px' }}
              >
                {n}
              </Link>
            ),
          )}

          <Flecha
            href={href(pagina + 1)}
            activo={pagina < paginas}
            label="Página siguiente"
          >
            →
          </Flecha>
        </nav>
      )}
    </div>
  )
}

function Flecha({
  href,
  activo,
  label,
  children,
}: {
  href: string
  activo: boolean
  label: string
  children: React.ReactNode
}) {
  if (!activo) {
    return (
      <span
        className="btn btn-ghost btn-sm"
        aria-disabled="true"
        style={{ opacity: 0.35, minWidth: 34, padding: '7px 9px', cursor: 'default' }}
      >
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="btn btn-ghost btn-sm"
      style={{ minWidth: 34, padding: '7px 9px' }}
    >
      {children}
    </Link>
  )
}

/**
 * Qué números mostrar. `null` es un salto (…).
 *
 * Con 7 páginas o menos se muestran todas. Con más: primera, última, la
 * actual y dos vecinas de cada lado.
 */
function numeros(actual: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const set = new Set<number>([1, total, actual])
  for (let d = 1; d <= 2; d++) {
    if (actual - d > 1) set.add(actual - d)
    if (actual + d < total) set.add(actual + d)
  }

  const ordenados = [...set].sort((a, b) => a - b)
  const salida: (number | null)[] = []
  let previo = 0
  for (const n of ordenados) {
    if (previo && n - previo > 1) salida.push(null)
    salida.push(n)
    previo = n
  }
  return salida
}
