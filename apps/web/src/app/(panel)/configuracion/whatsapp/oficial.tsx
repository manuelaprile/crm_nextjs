import { conectarCloudApi } from '@/lib/cloud-alta'
import type { WhatsAppAccount } from '@/lib/queries'

/**
 * Alta del número por el canal OFICIAL de Meta (Cloud API).
 *
 * Convive con el QR, no lo reemplaza: son dos proveedores del mismo canal y
 * cada cliente usa el que le sirve. El de acá no se puede bloquear por usar
 * una librería no oficial, y contestarle a alguien que escribió no cuesta
 * nada; a cambio, el alta exige que el cliente tenga cuenta de Meta.
 *
 * Hoy los datos se cargan a mano. Cuando Meta apruebe la cuenta como Tech
 * Provider, un botón de Embedded Signup va a llenar estos mismos campos desde
 * una ventana de Facebook, y nada de lo que hay debajo cambia.
 */
export function CanalOficial({ cuentas }: { cuentas: WhatsAppAccount[] }) {
  const oficial = cuentas.find((c) => c.provider === 'cloud_api')

  return (
    <div className="panel-box" style={{ marginBottom: 16 }}>
      <div className="panel-box-head">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            Canal oficial de Meta
            {oficial ? (
              <span className="badge b-green badge-dot">Configurado</span>
            ) : (
              <span className="badge b-gray">Opcional</span>
            )}
          </h3>
          <p className="tiny muted" style={{ marginTop: 3 }}>
            La vía autorizada por WhatsApp. El número no se puede bloquear por
            usar una conexión no oficial, y responder a quien escribió es
            gratis.
          </p>
        </div>
      </div>

      <div className="panel-box-body">
        {oficial ? (
          <div className="alert alert-green" style={{ marginBottom: 14 }}>
            <span>
              Conectado por el canal oficial
              {oficial.phone ? ` (+${oficial.phone})` : ''}. Token cargado:{' '}
              <span className="mono">{oficial.tokenHint ?? '—'}</span>. Volvé a
              cargar los datos abajo para reemplazarlo.
            </span>
          </div>
        ) : (
          <div className="alert alert-gray" style={{ marginBottom: 14 }}>
            <span>
              Para usarlo, el cliente necesita una cuenta de WhatsApp Business
              en Meta. Los dos datos salen de <strong>WhatsApp Manager →
              Configuración de la API</strong>. Si preferís seguir con el QR,
              ignorá esta sección: no hace falta.
            </span>
          </div>
        )}

        <form action={conectarCloudApi} style={{ display: 'grid', gap: 12 }}>
          <div className="field">
            <label htmlFor="phoneNumberId">Identificador del número</label>
            <input
              id="phoneNumberId"
              name="phoneNumberId"
              className="input"
              placeholder="109876543210987"
              inputMode="numeric"
              required
            />
            <p className="tiny muted" style={{ marginTop: 4 }}>
              El «Phone number ID», solo dígitos. No es el teléfono.
            </p>
          </div>

          <div className="field">
            <label htmlFor="token">Token de acceso</label>
            <input
              id="token"
              name="token"
              className="input"
              type="password"
              placeholder="EAAG…"
              autoComplete="off"
              required
            />
            <p className="tiny muted" style={{ marginTop: 4 }}>
              Se guarda cifrado. Una vez cargado no se puede volver a leer
              desde el panel, ni por vos.
            </p>
          </div>

          <div className="field">
            <label htmlFor="telefono">Teléfono (opcional)</label>
            <input
              id="telefono"
              name="telefono"
              className="input"
              placeholder="5493511234567"
              inputMode="numeric"
            />
          </div>

          <div className="field">
            <label htmlFor="wabaId">Id de la cuenta de WhatsApp (opcional)</label>
            <input
              id="wabaId"
              name="wabaId"
              className="input"
              placeholder="WABA ID"
              inputMode="numeric"
            />
          </div>

          <div>
            <button type="submit" className="btn btn-primary">
              {oficial ? 'Reemplazar credenciales' : 'Conectar por canal oficial'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
