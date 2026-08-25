import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { etiquetaDe, delRubro } from '@/lib/etiquetas'
import { ListaConversaciones } from './lista'

export const dynamic = 'force-dynamic'

/**
 * Bandeja sin conversación abierta.
 *
 * Es la misma pantalla de tres columnas que `[id]`, con el centro vacío: así
 * al abrir un chat no se remaqueta nada, solo se llena el medio.
 */
export default async function BandejaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; atiende?: string; p?: string }>
}) {
  const session = await requireTenant()
  const etiqueta = etiquetaDe(session)
  const { q, atiende, p } = await searchParams
  const filtro = atiende === 'ia' || atiende === 'humano' ? atiende : undefined

  return (
    <>
      <div className="topnav">
        <h2>Bandeja</h2>
      </div>

      <div className="wa">
        <ListaConversaciones
          session={session}
          q={q}
          atiende={filtro}
          pagina={Number(p) || 1}
        />

        <div className="wa-chat wa-vacio">
          <div className="empty">
            <b>Elegí una conversación</b>
            Cuando alguien escriba al WhatsApp {delRubro(etiqueta)}, aparece en
            la lista de la izquierda.
            <div style={{ marginTop: 16 }}>
              <Link
                href="/configuracion/whatsapp"
                className="btn btn-ghost btn-sm"
              >
                Conectar WhatsApp
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
