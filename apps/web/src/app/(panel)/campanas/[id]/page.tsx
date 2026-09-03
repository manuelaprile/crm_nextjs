import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { moduloActivo } from '@/lib/modulos'
import { verCampana } from '@/lib/campanas'
import { opcionesDeFiltro } from '../datos'
import { plantillasAprobadas } from '@/lib/plantillas'
import { Compositor } from '../compositor'

export const dynamic = 'force-dynamic'

// El estado en castellano y con color. En la base son códigos porque los lee
// el sistema; en pantalla los lee una persona.
const ROTULO: Record<string, string> = {
  borrador: 'Borrador',
  enviando: 'Enviando…',
  enviada: 'Enviada',
  error: 'Falló el envío',
}
const TONO: Record<string, string> = {
  borrador: 'b-gray',
  enviando: 'b-blue',
  enviada: 'b-green',
  error: 'b-red',
}

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

  const [opciones, plantillas] = await Promise.all([
    opcionesDeFiltro(),
    plantillasAprobadas(),
  ])

  return (
    <>
      <div className="topnav">
        <h2>{campana.nombre}</h2>
        <span className={`badge ${TONO[campana.estado] ?? 'b-gray'}`}>
          {ROTULO[campana.estado] ?? campana.estado}
        </span>
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
        {/* Lo que contestó Zernio, tal cual. Los errores de Meta nombran el
            campo que estuvo mal, y resumirlos pierde justo ese dato. */}
        {campana.errorEnvio ? (
          <div className="alert alert-red" style={{ marginBottom: 16 }}>
            <span>{campana.errorEnvio}</span>
          </div>
        ) : null}
        <Compositor
          campana={campana}
          opciones={opciones}
          plantillas={plantillas}
          negocio={session.tenantName ?? 'Tu negocio'}
        />
      </div>
    </>
  )
}
