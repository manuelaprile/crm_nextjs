import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { listarUsuariosPlataforma } from '@/lib/plataforma-usuarios'
import { IconSearch } from '@/components/icons'
import { Paginacion } from '@/components/paginacion'
import { AccionesUsuario, CuentasDelUsuario } from './acciones'
import { fechaHora } from '@/lib/fechas'

export const dynamic = 'force-dynamic'

/**
 * La vista de plataforma cruza cuentas de husos distintos, así que no existe
 * "la zona de la cuenta": se muestra todo en la de la plataforma. Es una
 * decisión, no un olvido — mezclar husos en una misma columna sería peor.
 */
const ZONA_PLATAFORMA = 'America/Argentina/Buenos_Aires'

/**
 * Todos los usuarios del sistema, de todas las cuentas.
 *
 * La lista de usuarios de cada cuenta sigue estando adentro de esa cuenta
 * (Configuración → Usuarios), que es donde la usa el cliente. Esta pantalla
 * es la de la plataforma: sirve para ver a quién pertenece cada usuario,
 * moverlo y darlo de baja sin tener que entrar cuenta por cuenta.
 *
 * Y sobre todo, para ver a los que no pertenecen a ninguna: pueden iniciar
 * sesión, el panel les dice que no están asignados a nada, y hasta que existió
 * esta pantalla no aparecían en ningún lado.
 */
export default async function UsuariosPlataformaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; pp?: string; r?: string; m?: string }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { q, p, pp, r, m } = await searchParams
  const porPagina = Number(pp) || 25
  const datos = await listarUsuariosPlataforma({
    pagina: Number(p) || 1,
    porPagina,
    buscar: q,
  })

  const link = (n: number) => {
    const sp = new URLSearchParams({ p: String(n) })
    if (porPagina !== 25) sp.set('pp', String(porPagina))
    if (q) sp.set('q', q)
    return `/superadmin/usuarios?${sp.toString()}`
  }

  return (
    <>
      <div className="topnav">
        <h2>Usuarios</h2>
        <span className="badge b-dark">Superadmin</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/superadmin/funciones" className="btn btn-ghost btn-sm">
            Funciones
          </Link>
          <Link href="/superadmin" className="btn btn-ghost btn-sm">
            Volver a cuentas
          </Link>
        </div>
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

        {datos.huerfanos > 0 && (
          <div className="alert alert-amber" style={{ marginBottom: 16 }}>
            <span>
              Hay <strong>{datos.huerfanos}</strong> usuario
              {datos.huerfanos === 1 ? '' : 's'} sin ninguna cuenta asignada.
              Pueden iniciar sesión, pero el panel les dice que no pertenecen a
              ningún lado. Aparecen primero en la lista: asignalos desde la
              cuenta que corresponda, o dalos de baja.
            </span>
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <div className="lbl">Usuarios</div>
            <div className="val mono">{datos.total}</div>
          </div>
          <div className="stat">
            <div className="lbl">Sin cuenta</div>
            <div className="val mono">{datos.huerfanos}</div>
          </div>
          <div className="stat">
            <div className="lbl">Sin acceso</div>
            <div className="val mono">
              {datos.filas.filter((u) => u.deshabilitado).length}
            </div>
            <div className="delta muted" style={{ fontWeight: 500 }}>
              de esta página
            </div>
          </div>
        </div>

        <form className="toolbar" action="/superadmin/usuarios">
          <div className="searchbox">
            <IconSearch />
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Buscar por nombre o correo…"
            />
          </div>
          <select
            name="pp"
            defaultValue={String(porPagina)}
            className="select"
            style={{ width: 'auto' }}
            aria-label="Usuarios por página"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} por página</option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
        </form>

        <div className="panel-box">
          <div className="panel-box-head">
            <h3>Todos los usuarios</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Cuentas asignadas</th>
                  <th>Acceso</th>
                  <th>Último ingreso</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {datos.filas.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span
                        style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}
                      >
                        {u.name}
                        {u.soyYo && (
                          <span className="badge b-dark" style={{ marginLeft: 7 }}>
                            vos
                          </span>
                        )}
                        {u.esSuperadmin && (
                          <span className="badge b-dark" style={{ marginLeft: 7 }}>
                            superadmin
                          </span>
                        )}
                      </span>
                      <span className="tiny muted mono">{u.email}</span>
                    </td>
                    <td>
                      <CuentasDelUsuario usuario={u} />
                    </td>
                    <td>
                      {u.deshabilitado ? (
                        <span className="badge b-red badge-dot">Sin acceso</span>
                      ) : (
                        <span className="badge b-green badge-dot">Activo</span>
                      )}
                    </td>
                    <td className="tiny muted">
                      {u.ultimoIngreso
                        ? fechaHora(u.ultimoIngreso, ZONA_PLATAFORMA)
                        : 'Nunca entró'}
                    </td>
                    <td style={{ textAlign: 'right', position: 'relative' }}>
                      <AccionesUsuario usuario={u} />
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
        </div>

      </div>
    </>
  )
}
