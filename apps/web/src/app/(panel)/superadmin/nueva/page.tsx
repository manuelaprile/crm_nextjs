import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { listarRubros } from '@/lib/usuarios'
import { FormNuevaCuenta } from './form'

export const dynamic = 'force-dynamic'

/**
 * Alta de un cliente nuevo desde el panel.
 *
 * Antes esto era `./crm.sh consultorio ...` por SSH. El script sigue estando
 * (sirve para automatizar y para cuando el panel no levanta), pero el camino
 * normal es esta pantalla.
 *
 * Dar de alta una cuenta NO despliega nada: el sistema es multi-tenant, así
 * que es una fila en `tenants`, la plantilla del rubro y un usuario dueño.
 */
export default async function NuevaCuentaPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { r, m } = await searchParams
  const rubros = await listarRubros()

  return (
    <>
      <div className="topnav">
        <h2>Nueva cuenta</h2>
        <span className="badge b-dark">Superadmin</span>
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/superadmin" className="btn btn-ghost btn-sm">
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

        <div className="panel-box" style={{ maxWidth: 820 }}>
          <div className="panel-box-head">
            <div>
              <h3>Datos del cliente</h3>
              <p className="tiny muted" style={{ marginTop: 3 }}>
                Se crea la cuenta con su embudo, sus etiquetas y el asistente
                cargado pero <strong>apagado</strong>, y el usuario dueño para
                que pueda entrar.
              </p>
            </div>
          </div>
          <div className="panel-box-body">
            <FormNuevaCuenta rubros={rubros} />
          </div>
        </div>

      </div>
    </>
  )
}
