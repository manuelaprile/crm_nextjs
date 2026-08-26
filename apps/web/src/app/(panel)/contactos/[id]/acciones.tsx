import Link from 'next/link'
import {
  archivarContacto,
  desarchivarContacto,
  eliminarContacto,
} from '@/lib/actions'

/**
 * Archivar / desarchivar / eliminar.
 *
 * La confirmación de borrado es de DOS PASOS por navegación, no un
 * `confirm()` de JavaScript: si el JS falla, un `confirm()` no aparece y el
 * botón borra directo. Con un link a `?confirmar=borrar` la confirmación es
 * parte de la página y funciona siempre.
 */
export function AccionesContacto({
  contactId,
  archivado,
  confirmando,
  puedeEliminar,
}: {
  contactId: string
  archivado: boolean
  confirmando: boolean
  puedeEliminar: boolean
}) {
  if (confirmando) {
    return (
      <div className="panel-box" style={{ borderColor: 'var(--c-danger)' }}>
        <div className="panel-box-body">
          <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
            ¿Eliminar este contacto?
          </p>
          <p className="tiny muted" style={{ marginBottom: 14 }}>
            Se borran también sus conversaciones, mensajes, notas, etiquetas e
            historial de etapas. <strong>No se puede deshacer.</strong> Si solo
            querés sacarlo de la vista, archivalo.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <form action={eliminarContacto}>
              <input type="hidden" name="contactId" value={contactId} />
              <button
                type="submit"
                className="btn btn-sm"
                style={{ background: 'var(--c-danger)', color: '#fff' }}
              >
                Sí, eliminar definitivamente
              </button>
            </form>
            <Link
              href={`/contactos/${contactId}`}
              className="btn btn-ghost btn-sm"
            >
              Cancelar
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel-box">
      <div className="panel-box-head">
        <h3>Acciones</h3>
      </div>
      <div className="panel-box-body">
        {archivado && (
          <p className="tiny muted" style={{ marginBottom: 12 }}>
            Archivado. Si vuelve a escribir, reaparece solo.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <form action={archivado ? desarchivarContacto : archivarContacto}>
            <input type="hidden" name="contactId" value={contactId} />
            <button type="submit" className="btn btn-ghost btn-sm">
              {archivado ? 'Desarchivar' : 'Archivar'}
            </button>
          </form>

          {puedeEliminar && (
            <Link
              href={`/contactos/${contactId}?confirmar=borrar`}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--c-danger)' }}
            >
              Eliminar
            </Link>
          )}
        </div>

        <p className="tiny muted" style={{ marginTop: 10 }}>
          Archivar lo saca de la vista y conserva todo. Eliminar borra el
          contacto y sus conversaciones para siempre.
        </p>
      </div>
    </div>
  )
}
