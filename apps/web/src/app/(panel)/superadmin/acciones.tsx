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
    <div className="sa-acciones">
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

      {/*
        El panel crece HACIA ABAJO dentro de la fila y no flotando encima.
        La tabla vive en un `.table-scroll` con `overflow-x: auto`, y eso hace
        que el navegador recorte también en vertical: el cartel se abría, se
        veían dos líneas y el resto —incluido el campo de confirmación y el
        botón— quedaba cortado por el borde de la tabla. Es el mismo problema
        que tenían los menús de las tarjetas del tablero, y la misma
        solución. Ver `.bc-menu`.
      */}
      <details className="sa-borrar">
        <summary className="tiny muted" title="Eliminar la cuenta">
          ⋯
        </summary>
        <div className="sa-borrar-panel">
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
