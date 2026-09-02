import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { moduloActivo } from '@/lib/modulos'
import { opcionesDeFiltro } from '../datos'
import { Compositor } from '../compositor'

export const dynamic = 'force-dynamic'

/** Una campaña nueva. La puerta del módulo, igual que en el listado. */
export default async function NuevaCampanaPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  if (!(await moduloActivo('modulo:campanas', session.tenantId))) notFound()

  const { r, m } = await searchParams
  const opciones = await opcionesDeFiltro()

  return (
    <>
      <div className="topnav">
        <h2>Nueva campaña</h2>
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
        <Compositor campana={null} opciones={opciones} />
      </div>
    </>
  )
}
