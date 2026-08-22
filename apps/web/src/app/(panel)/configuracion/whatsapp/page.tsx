import { requireTenant } from '@/lib/auth'
import { getWhatsAppAccounts } from '@/lib/queries'
import { connectWhatsApp, disconnectWhatsApp } from '@/lib/actions'
import { AutoRefresh } from './auto-refresh'

export const dynamic = 'force-dynamic'

const ESTADOS: Record<string, { label: string; badge: string }> = {
  connected: { label: 'Conectado', badge: 'b-green' },
  connecting: { label: 'Conectando…', badge: 'b-amber' },
  qr_pending: { label: 'Esperando escaneo', badge: 'b-blue' },
  disconnected: { label: 'Desconectado', badge: 'b-gray' },
  logged_out: { label: 'Sesión cerrada', badge: 'b-red' },
  banned: { label: 'Número bloqueado', badge: 'b-red' },
}

export default async function WhatsAppPage() {
  const session = await requireTenant()
  const accounts = await getWhatsAppAccounts(session)
  const puedeGestionar = session.role !== 'agent'
  // Mientras negocia, la pantalla se refresca sola para que aparezca el QR.
  const negociando = accounts.some(
    (a) => a.status === 'connecting' || a.status === 'qr_pending',
  )

  return (
    <>
      <AutoRefresh activo={negociando} />
      <div className="topnav">
        <h2>WhatsApp</h2>
      </div>

      <div className="content">
        <div className="page-head">
          <p style={{ marginTop: 0 }}>
            Conectá el número del consultorio escaneando un código QR
          </p>
        </div>

        {accounts.length === 0 && (
          <div className="panel-box">
            <div className="empty">
              <b>Todavía no hay ningún número conectado</b>
              Al conectar vas a ver un código QR. Escanealo desde el celular del
              consultorio con WhatsApp → Dispositivos vinculados.
              {puedeGestionar ? (
                <form action={connectWhatsApp} style={{ marginTop: 18 }}>
                  <button type="submit" className="btn btn-primary">
                    Conectar WhatsApp
                  </button>
                </form>
              ) : (
                <p className="tiny" style={{ marginTop: 14 }}>
                  Solo el dueño o un administrador puede conectar el número.
                </p>
              )}
            </div>
          </div>
        )}

        {accounts.map((acc) => {
          const estado = ESTADOS[acc.status] ?? ESTADOS.disconnected!
          return (
            <div key={acc.id} className="panel-box" style={{ marginBottom: 16 }}>
              <div className="panel-box-head">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    {acc.label}
                    <span className={`badge ${estado.badge} badge-dot`}>
                      {estado.label}
                    </span>
                  </h3>
                  {acc.phone && (
                    <p className="tiny mono" style={{ marginTop: 4 }}>
                      +{acc.phone}
                    </p>
                  )}
                  {acc.connectedAt && acc.status === 'connected' && (
                    <p className="tiny muted" style={{ marginTop: 2 }}>
                      Conectado desde{' '}
                      {new Date(acc.connectedAt).toLocaleString('es-AR')}
                    </p>
                  )}
                </div>

                {puedeGestionar && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {acc.status !== 'connected' && (
                      <form action={connectWhatsApp}>
                        <input type="hidden" name="accountId" value={acc.id} />
                        <button type="submit" className="btn btn-primary btn-sm">
                          {acc.status === 'logged_out'
                            ? 'Volver a escanear'
                            : acc.qrVencido
                              ? 'Generar código nuevo'
                              : 'Conectar'}
                        </button>
                      </form>
                    )}
                    {acc.status === 'connected' && (
                      <form action={disconnectWhatsApp}>
                        <input type="hidden" name="accountId" value={acc.id} />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Desconectar
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              <div className="panel-box-body">
                {acc.lastError && (
                  <div className="alert alert-amber" style={{ marginBottom: 14 }}>
                    {acc.lastError}
                  </div>
                )}

                {acc.qrVencido && (
                  <div className="alert alert-amber">
                    El código QR venció sin que nadie lo escaneara. Tocá
                    «Generar código nuevo».
                  </div>
                )}

                {acc.status === 'connecting' && (
                  <div className="alert alert-gray">
                    Generando el código… aparece en unos segundos.
                  </div>
                )}

                {acc.qr && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      background: 'var(--c-surface)',
                      borderRadius: 'var(--r-md)',
                      padding: 26,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={acc.qr}
                      alt="Código QR para vincular WhatsApp"
                      width={272}
                      height={272}
                      style={{
                        background: '#fff',
                        padding: 12,
                        borderRadius: 'var(--r-md)',
                      }}
                    />
                    <ol
                      className="tiny muted"
                      style={{
                        marginTop: 16,
                        listStyle: 'none',
                        display: 'grid',
                        gap: 3,
                        textAlign: 'center',
                      }}
                    >
                      <li>1. Abrí WhatsApp en el celular del consultorio</li>
                      <li>2. Menú → Dispositivos vinculados</li>
                      <li>3. Vincular un dispositivo</li>
                      <li>4. Escaneá este código</li>
                    </ol>
                    <p className="tiny muted" style={{ marginTop: 12 }}>
                      El código vence al minuto. La pantalla se actualiza sola.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <div className="alert alert-gray" style={{display: 'none'}}>
          <span>
            <b style={{ fontWeight: 600 }}>Importante:</b> la vinculación por QR
            no es una integración oficial de Meta. Usá un número dedicado al
            consultorio y no el personal. El sistema solo responde a quien
            escribe primero y nunca hace envíos masivos.
          </span>
        </div>
      </div>
    </>
  )
}
