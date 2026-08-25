import { conectarZernio } from '@/lib/zernio-alta'
import { delRubro, type Etiqueta } from '@/lib/etiquetas'
import type { WhatsAppAccount } from '@/lib/queries'

/**
 * Alta de un número con un botón.
 *
 * Es el canal oficial de Meta, pero a través de Zernio, que ya está aprobado
 * como Tech Provider. Para el cliente es: apretar, elegir su cuenta en una
 * ventana de Facebook, listo.
 *
 * La diferencia que le importa al cliente: va en modo coexistence, así que
 * **el número sigue funcionando en su celular**. No pierde WhatsApp.
 */
export function CanalZernio({
  cuentas,
  etiqueta,
  disponible,
}: {
  cuentas: WhatsAppAccount[]
  etiqueta: Etiqueta
  disponible: boolean
}) {
  const cuenta = cuentas.find((c) => c.provider === 'zernio')

  return (
    <div className="panel-box" style={{ marginBottom: 16 }}>
      <div className="panel-box-head">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            Conectar WhatsApp
            {cuenta ? (
              <span className="badge b-green badge-dot">Conectado</span>
            ) : (
              <span className="badge b-blue">Recomendado</span>
            )}
          </h3>
          <p className="tiny muted" style={{ marginTop: 3 }}>
            La vía oficial de Meta. El número no se puede bloquear por usar una
            conexión no autorizada, y <strong>sigue funcionando en el
            celular</strong> {delRubro(etiqueta)} como siempre.
          </p>
        </div>
      </div>

      <div className="panel-box-body">
        {cuenta ? (
          <div className="alert alert-green" style={{ marginBottom: 14 }}>
            <span>
              Conectado{cuenta.phone ? ` (+${cuenta.phone})` : ''}. Los mensajes
              entran solos en la bandeja.
            </span>
          </div>
        ) : (
          <div className="alert alert-gray" style={{ marginBottom: 14 }}>
            <span>
              Al apretar el botón se abre una ventana de Facebook para elegir la
              cuenta de WhatsApp Business. Son dos o tres pantallas y vuelve
              solo. No hay ningún código que escanear.
            </span>
          </div>
        )}

        {!disponible && (
          <div className="alert alert-amber" style={{ marginBottom: 14 }}>
            Falta configurar la clave del proveedor en el servidor
            (<span className="mono">ZERNIO_API_KEY</span>).
          </div>
        )}

        <form action={conectarZernio}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!disponible}
          >
            {cuenta ? 'Conectar otro número' : 'Conectar WhatsApp'}
          </button>
        </form>
      </div>
    </div>
  )
}
