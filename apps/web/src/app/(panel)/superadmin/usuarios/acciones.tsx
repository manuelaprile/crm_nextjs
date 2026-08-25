import {
  quitarDeCuenta,
  habilitarUsuario,
  eliminarUsuario,
  type UsuarioPlataforma,
} from '@/lib/plataforma-usuarios'

const ROLES: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  agent: 'Secretaria',
}

/**
 * Las cuentas a las que pertenece un usuario, cada una con su botón para
 * sacarlo de ahí.
 *
 * Quitar es por cuenta y no global a propósito: alguien puede atender dos
 * sucursales y hay que poder sacarlo de una sola.
 */
export function CuentasDelUsuario({ usuario }: { usuario: UsuarioPlataforma }) {
  if (!usuario.cuentas.length) {
    return (
      <span className="badge b-amber">Ninguna</span>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {usuario.cuentas.map((c) => (
        <div
          key={c.tenantId}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span style={{ fontSize: 13 }}>
            {c.nombre}
            <span className="tiny muted"> · {ROLES[c.rol] ?? c.rol}</span>
            {c.estado !== 'active' && c.estado !== 'trial' && (
              <span className="badge b-red" style={{ marginLeft: 6 }}>
                {c.estado}
              </span>
            )}
          </span>
          <form action={quitarDeCuenta} style={{ marginLeft: 'auto' }}>
            <input type="hidden" name="userId" value={usuario.id} />
            <input type="hidden" name="tenantId" value={c.tenantId} />
            <input type="hidden" name="quien" value={usuario.name} />
            <input type="hidden" name="donde" value={c.nombre} />
            <button
              type="submit"
              className="btn btn-ghost btn-sm"
              title={`Quitar a ${usuario.name} de ${c.nombre}`}
            >
              Quitar
            </button>
          </form>
        </div>
      ))}
    </div>
  )
}

/**
 * Acceso y baja.
 *
 * Quitar el acceso queda a la vista porque es reversible y es lo que se
 * necesita el 95% de las veces. Eliminar está adentro del desplegable y pide
 * escribir el mail: además de irreversible, deja sin autor las filas de
 * auditoría de esa persona.
 */
export function AccionesUsuario({ usuario }: { usuario: UsuarioPlataforma }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <form action={habilitarUsuario}>
        <input type="hidden" name="userId" value={usuario.id} />
        <input type="hidden" name="quien" value={usuario.name} />
        <input
          type="hidden"
          name="habilitar"
          value={usuario.deshabilitado ? 'si' : 'no'}
        />
        <button
          type="submit"
          className="btn btn-ghost btn-sm"
          disabled={usuario.soyYo}
          title={
            usuario.soyYo
              ? 'No podés quitarte el acceso a vos mismo.'
              : undefined
          }
        >
          {usuario.deshabilitado ? 'Devolver acceso' : 'Quitar acceso'}
        </button>
      </form>

      {!usuario.soyYo && !usuario.esSuperadmin && (
        <details>
          <summary
            className="tiny muted"
            style={{ cursor: 'pointer', listStyle: 'none', padding: '6px 4px' }}
            title="Eliminar el usuario"
          >
            ⋯
          </summary>
          <div
            style={{
              position: 'absolute',
              right: 16,
              zIndex: 10,
              marginTop: 6,
              width: 320,
              textAlign: 'left',
              background: 'var(--c-surface)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-md)',
              padding: 14,
              boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
            }}
          >
            <p className="tiny" style={{ marginTop: 0, marginBottom: 10 }}>
              <strong>Eliminar a {usuario.name}</strong> lo borra para siempre
              y deja <strong>sin autor</strong> todo lo que hizo en la
              auditoría. Si solo querés que no pueda entrar,{' '}
              <strong>quitale el acceso</strong>: es reversible y el historial
              se conserva.
            </p>
            <form action={eliminarUsuario} style={{ display: 'grid', gap: 8 }}>
              <input type="hidden" name="userId" value={usuario.id} />
              <input type="hidden" name="email" value={usuario.email} />
              <label className="tiny muted" htmlFor={`conf-u-${usuario.id}`}>
                Escribí <span className="mono">{usuario.email}</span> para
                confirmar
              </label>
              <input
                id={`conf-u-${usuario.id}`}
                name="confirmacion"
                className="input"
                autoComplete="off"
                placeholder={usuario.email}
                required
              />
              <button type="submit" className="btn btn-danger btn-sm">
                Eliminar definitivamente
              </button>
            </form>
          </div>
        </details>
      )}
    </div>
  )
}
