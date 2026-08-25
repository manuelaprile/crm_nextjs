import { entrarACuenta } from '@/lib/usuarios'
import { cambiarEstadoCuenta, eliminarCuenta } from '@/lib/plataforma'
import type { FilaCuenta } from '@/lib/usuarios'

/**
 * Lo que se puede hacer con una cuenta desde la vista de plataforma.
 *
 * «Entrar» y suspender/reactivar quedan a la vista porque son las de todos
 * los días. Eliminar está adentro de un desplegable y pide escribir el slug:
 * es la única operación del sistema que no se puede deshacer, y la distancia
 * entre "quería suspenderla" y "borré un consultorio entero" tiene que ser
 * más que un clic al lado del otro.
 */
export function AccionesCuenta({
  cuenta,
  adentro,
}: {
  cuenta: FilaCuenta
  /** Si el superadmin está parado justo en esta cuenta. */
  adentro: boolean
}) {
  const suspendida =
    cuenta.status === 'suspended' || cuenta.status === 'cancelled'

  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      {!suspendida && (
        <form action={entrarACuenta}>
          <input type="hidden" name="tenantId" value={cuenta.id} />
          <button type="submit" className="btn btn-ghost btn-sm">
            Entrar
          </button>
        </form>
      )}

      <form action={cambiarEstadoCuenta}>
        <input type="hidden" name="tenantId" value={cuenta.id} />
        <input type="hidden" name="nombre" value={cuenta.name} />
        <input
          type="hidden"
          name="estado"
          value={suspendida ? 'active' : 'suspended'}
        />
        <button
          type="submit"
          className="btn btn-ghost btn-sm"
          // Suspender la cuenta en la que uno está parado deja al superadmin
          // sin sesión válida. La función de Postgres lo rechaza igual; esto
          // es para no ofrecer un botón que no va a funcionar.
          disabled={adentro && !suspendida}
          title={
            adentro && !suspendida
              ? 'Estás adentro de esta cuenta. Salí a Plataforma para suspenderla.'
              : undefined
          }
        >
          {suspendida ? 'Reactivar' : 'Suspender'}
        </button>
      </form>

      <details>
        <summary
          className="tiny muted"
          style={{ cursor: 'pointer', listStyle: 'none', padding: '6px 4px' }}
          title="Eliminar la cuenta"
        >
          ⋯
        </summary>
        <div
          style={{
            position: 'absolute',
            right: 16,
            zIndex: 10,
            marginTop: 6,
            width: 300,
            textAlign: 'left',
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-md)',
            padding: 14,
            boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
          }}
        >
          <p className="tiny" style={{ marginTop: 0, marginBottom: 10 }}>
            <strong>Eliminar «{cuenta.name}»</strong> borra también sus{' '}
            {cuenta.contactos} contactos, {cuenta.conversaciones}{' '}
            conversaciones y todos sus mensajes. <strong>No hay vuelta
            atrás.</strong> Si es un cliente que dejó de pagar, suspendela.
          </p>
          <form action={eliminarCuenta} style={{ display: 'grid', gap: 8 }}>
            <input type="hidden" name="tenantId" value={cuenta.id} />
            <input type="hidden" name="slug" value={cuenta.slug} />
            <label className="tiny muted" htmlFor={`conf-${cuenta.id}`}>
              Escribí <span className="mono">{cuenta.slug}</span> para confirmar
            </label>
            <input
              id={`conf-${cuenta.id}`}
              name="confirmacion"
              className="input"
              autoComplete="off"
              placeholder={cuenta.slug}
              required
            />
            <button type="submit" className="btn btn-danger btn-sm">
              Eliminar definitivamente
            </button>
          </form>
        </div>
      </details>
    </div>
  )
}
