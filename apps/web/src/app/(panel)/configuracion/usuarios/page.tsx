import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { IconSearch } from '@/components/icons'
import { Paginacion } from '@/components/paginacion'
import {
  listarUsuarios,
  crearUsuario,
  cambiarRol,
  quitarUsuario,
  resetearClave,
} from '@/lib/usuarios'

export const dynamic = 'force-dynamic'

const ROLES: Record<string, { label: string; descripcion: string }> = {
  owner: { label: 'Dueño', descripcion: 'Todo, incluida la gestión de usuarios' },
  admin: { label: 'Administrador', descripcion: 'Todo salvo crear otros dueños' },
  agent: {
    label: 'Operador',
    descripcion: 'Bandeja y contactos. No toca WhatsApp, IA ni usuarios',
  },
}

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{
    r?: string
    m?: string
    q?: string
    p?: string
    pp?: string
  }>
}) {
  const session = await requireTenant()
  if (session.role === 'agent') notFound()

  const { r, m, q, p, pp } = await searchParams
  const porPagina = Number(pp) || 25
  const datos = await listarUsuarios({
    pagina: Number(p) || 1,
    porPagina,
    buscar: q,
  })
  const usuarios = datos.filas
  const esDueno = session.role === 'owner'

  const link = (n: number) => {
    const sp = new URLSearchParams({ p: String(n) })
    if (porPagina !== 25) sp.set('pp', String(porPagina))
    if (q) sp.set('q', q)
    return `/configuracion/usuarios?${sp.toString()}`
  }

  return (
    <>
      <div className="topnav">
        <h2>Usuarios</h2>
        <span className="badge b-gray mono">{datos.total}</span>
      </div>

      <div className="content">
        {r && m && (
          <div
            className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
            style={{ marginBottom: 16 }}
          >
            {m}
          </div>
        )}

        <form className="toolbar" action="/configuracion/usuarios">
          <div className="searchbox">
            <IconSearch />
            <input name="q" defaultValue={q ?? ''} placeholder="Buscar por nombre o email…" />
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
          {(q || porPagina !== 25) && (
            <a href="/configuracion/usuarios" className="btn btn-ghost btn-sm">Limpiar</a>
          )}
        </form>

        <div className="panel-box" style={{ marginBottom: 16 }}>
          <div className="panel-box-head">
            <h3>Quién tiene acceso</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Último ingreso</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.userId}>
                    <td>
                      <span
                        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                      >
                        <span className="avatar">{iniciales(u.name)}</span>
                        <span>
                          <span
                            style={{
                              display: 'block',
                              fontWeight: 600,
                              fontSize: 13.5,
                            }}
                          >
                            {u.name}
                            {u.soyYo && (
                              <span className="badge b-gray" style={{ marginLeft: 7 }}>
                                vos
                              </span>
                            )}
                            {u.esSuperadmin && (
                              <span className="badge b-dark" style={{ marginLeft: 7 }}>
                                superadmin
                              </span>
                            )}
                          </span>
                          <span className="tiny muted">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      {u.soyYo ? (
                        <span className="badge b-gray">{ROLES[u.role]?.label}</span>
                      ) : (
                        <form
                          action={cambiarRol}
                          style={{ display: 'flex', gap: 6 }}
                        >
                          <input type="hidden" name="userId" value={u.userId} />
                          <select
                            name="rol"
                            defaultValue={u.role}
                            className="select"
                            style={{ width: 'auto', padding: '5px 8px', fontSize: 12.5 }}
                          >
                            {Object.entries(ROLES)
                              .filter(([k]) => k !== 'owner' || esDueno)
                              .map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v.label}
                                </option>
                              ))}
                          </select>
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Cambiar
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="tiny muted mono">
                      {u.ultimoIngreso
                        ? new Date(u.ultimoIngreso).toLocaleDateString('es-AR')
                        : 'nunca'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!u.soyYo && (
                        <details>
                          <summary
                            className="btn btn-ghost btn-sm"
                            style={{ display: 'inline-flex', listStyle: 'none' }}
                          >
                            Gestionar
                          </summary>
                          <div
                            style={{
                              marginTop: 8,
                              padding: 12,
                              background: 'var(--c-surface)',
                              borderRadius: 'var(--r-sm)',
                              textAlign: 'left',
                              display: 'grid',
                              gap: 10,
                            }}
                          >
                            <form action={resetearClave} className="field">
                              <input type="hidden" name="userId" value={u.userId} />
                              <label>Contraseña nueva</label>
                              <input
                                name="clave"
                                type="password"
                                minLength={8}
                                required
                                className="input"
                                placeholder="Mínimo 8 caracteres"
                              />
                              <button type="submit" className="btn btn-ghost btn-sm">
                                Cambiar contraseña
                              </button>
                            </form>
                            <form action={quitarUsuario}>
                              <input type="hidden" name="userId" value={u.userId} />
                              <button
                                type="submit"
                                className="btn btn-ghost btn-sm"
                                style={{ color: 'var(--c-danger)' }}
                              >
                                Quitar del consultorio
                              </button>
                            </form>
                          </div>
                        </details>
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
        </div>

        <div className="panel-box">
          <div className="panel-box-head">
            <div>
              <h3>Agregar un usuario</h3>
              <p className="tiny muted" style={{ marginTop: 3 }}>
                Se le crea la cuenta con la contraseña que pongas. Pedile que la
                cambie al entrar.
              </p>
            </div>
          </div>
          <div className="panel-box-body">
            <form action={crearUsuario} style={{ display: 'grid', gap: 14 }}>
              <div className="cols2b">
                <div className="field">
                  <label htmlFor="nombre">Nombre</label>
                  <input id="nombre" name="nombre" required className="input" />
                </div>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    className="input"
                  />
                </div>
              </div>
              <div className="cols2b">
                <div className="field">
                  <label htmlFor="clave">Contraseña</label>
                  <input
                    id="clave"
                    name="clave"
                    type="password"
                    minLength={8}
                    required
                    className="input"
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>
                <div className="field">
                  <label htmlFor="rol">Rol</label>
                  <select id="rol" name="rol" defaultValue="agent" className="select">
                    {Object.entries(ROLES)
                      .filter(([k]) => k !== 'owner' || esDueno)
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div>
                <button type="submit" className="btn btn-primary">
                  Crear usuario
                </button>
              </div>
            </form>

            <div style={{ marginTop: 20, display: 'grid', gap: 6 }}>
              {Object.entries(ROLES).map(([k, v]) => (
                <div key={k} className="kv">
                  <span className="badge b-gray">{v.label}</span>
                  <span className="tiny muted" style={{ textAlign: 'right' }}>
                    {v.descripcion}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
