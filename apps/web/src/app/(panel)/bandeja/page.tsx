import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { etiquetaDe, delRubro } from '@/lib/etiquetas'
import { getWhatsAppAccounts } from '@/lib/queries'
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
  const filtro =
    atiende === 'ia' || atiende === 'humano' || atiende === 'visita'
      ? atiende
      : undefined

  /**
   * El centro solo invita a conectar si NO hay ningún número andando.
   *
   * Antes esa invitación estaba siempre, así que a un cliente con WhatsApp
   * conectado y trabajando le seguía apareciendo un botón para conectarlo, y
   * un cartel explicándole algo que ya hizo. Con un canal activo el centro
   * queda vacío y listo: la columna se va a llenar cuando abra un chat.
   */
  const cuentas = await getWhatsAppAccounts(session)
  const hayCanal = cuentas.some(
    (c) => c.status === 'connected' || c.status === 'connecting',
  )

  return (
    <>
      <div className="topnav">
        <h2>Bandeja</h2>
      </div>

      <div className="wa">
        <ListaConversaciones
          session={session}
          zona={session.tenantZona}
          q={q}
          atiende={filtro}
          pagina={Number(p) || 1}
        />

        <div className="wa-chat wa-vacio">
          {!hayCanal && (
            <div className="empty">
              <b>Todavía no hay WhatsApp conectado</b>
              Cuando conectes el número {delRubro(etiqueta)}, los mensajes
              aparecen en la lista de la izquierda.
              <div style={{ marginTop: 16 }}>
                <Link
                  href="/configuracion/whatsapp"
                  className="btn btn-ghost btn-sm"
                >
                  Conectar WhatsApp
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
