import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { moduloActivo } from '@/lib/modulos'
import { listarCampanas } from '@/lib/campanas'
import { borrarCampana } from '@/lib/campanas-acciones'

export const dynamic = 'force-dynamic'

/**
 * Las campañas de la cuenta.
 *
 * PUERTA DEL MÓDULO. Que el ítem no aparezca en el menú es prolijidad, no
 * seguridad: cualquiera puede escribir /campanas en la barra. El `notFound()`
 * de acá es lo que cierra la pantalla, y va del lado del servidor.
 *
 * Se devuelve 404 y no "no tenés este módulo" a propósito: para una cuenta
 * que no lo contrató, esta sección no existe. Un cartel que dice "esto se
 * compra aparte" en el medio del panel es publicidad adentro de una
 * herramienta de trabajo.
 */
export default async function CampanasPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  if (!(await moduloActivo('modulo-campanas', session.tenantId))) notFound()

  const { r, m } = await searchParams
  const campanas = await listarCampanas()

  return (
    <>
      <div className="topnav">
        <h2>Campañas</h2>
        <span className="badge b-gray mono">{campanas.length}</span>
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/campanas/nueva" className="btn btn-primary btn-sm">
            Nueva campaña
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

        {campanas.length === 0 ? (
          <div className="panel-box">
            <div className="empty">
              <b>Todavía no hay campañas</b>
              Armá una y quedará guardada como borrador.
            </div>
          </div>
        ) : (
          <div className="panel-box">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Campaña</th>
                    <th>Destinatarios</th>
                    <th>Estado</th>
                    <th>Modificada</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {campanas.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link
                          href={`/campanas/${c.id}`}
                          style={{ fontWeight: 600, fontSize: 13.5 }}
                          className="enlace"
                        >
                          {c.nombre}
                        </Link>
                        {c.tieneImagen && (
                          <span className="tiny muted" style={{ marginLeft: 8 }}>
                            con imagen
                          </span>
                        )}
                      </td>
                      <td className="muted">
                        {c.destino === 'todos'
                          ? 'Todos'
                          : c.destino === 'manual'
                            ? `${c.elegidos.length} elegidos a mano`
                            : 'Por filtros'}
                      </td>
                      <td>
                        <span className="badge b-gray">{c.estado}</span>
                      </td>
                      <td className="muted tiny mono">{c.actualizada}</td>
                      <td style={{ textAlign: 'right' }}>
                        <form action={borrarCampana}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Borrar
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
