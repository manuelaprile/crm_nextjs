import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { moduloActivo } from '@/lib/modulos'
import { verCampana } from '@/lib/campanas'
import { opcionesDeFiltro } from '../datos'
import { Compositor } from '../compositor'

export const dynamic = 'force-dynamic'

/**
 * Editar una campaña guardada.
 *
 * `verCampana` va por `withTenant`, así que quien decide si esta campaña es
 * de esta cuenta es RLS y no un `where` que alguien puede olvidarse. Cambiar
 * el uuid de la URL no sirve ni adivinando uno válido.
 */
export default async function EditarCampanaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  if (!(await moduloActivo('modulo-campanas', session.tenantId))) notFound()

  const { id } = await params
  const { r, m } = await searchParams
  const campana = await verCampana(id)
  if (!campana) notFound()

  const opciones = await opcionesDeFiltro()

  return (
    <>
      <div className="topnav">
        <h2>{campana.nombre}</h2>
        <span className="badge b-gray">{campana.estado}</span>
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/campanas" className="btn btn-ghost btn-sm">
            Volver
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
        <Compositor
          campana={campana}
          opciones={opciones}
          negocio={session.tenantName ?? 'Tu negocio'}
        />
      </div>
    </>
  )
}
