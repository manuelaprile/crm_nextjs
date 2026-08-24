import { requireTenant } from '@/lib/auth'
import { etiquetaDe, delRubro } from '@/lib/etiquetas'
import { TabsConfiguracion } from './tabs'

export const dynamic = 'force-dynamic'

/**
 * Marco de Configuración: un solo título y las solapas.
 *
 * Las páginas de adentro no ponen su propia barra de título ni su propio
 * `.content` — los pone esto. Si cada una trajera el suyo, al cambiar de
 * solapa se movería todo un par de píxeles.
 */
export default async function ConfiguracionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireTenant()
  const etiqueta = etiquetaDe(session)

  return (
    <>
      <div className="topnav">
        <h2>Configuración</h2>
      </div>
      <div className="content">
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
          Todo lo que define la identidad y el funcionamiento {delRubro(etiqueta)}.
        </p>
        <TabsConfiguracion />
        {children}
      </div>
    </>
  )
}
