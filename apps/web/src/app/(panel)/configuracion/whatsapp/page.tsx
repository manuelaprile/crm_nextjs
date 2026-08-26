import { requireTenant } from '@/lib/auth'
import { etiquetaDe, delRubro, alRubro } from '@/lib/etiquetas'
import { getWhatsAppAccounts } from '@/lib/queries'
import { connectWhatsApp, disconnectWhatsApp } from '@/lib/actions'
import { AutoRefresh } from './auto-refresh'
import { CanalZernio } from './zernio'
import { zernioActivo } from '@/lib/zernio'
// El alta manual del canal oficial de Meta queda ESCONDIDA, no borrada: el
// código anda y está probado, pero pide que el cliente cree su cuenta en
// Meta a mano y encima le saca el número de la aplicación del celular. La
// conexión por Zernio hace lo mismo con un botón y sin perder la app, así
// que mostrar las dos solo confunde. Para volver a exponerla alcanza con
// devolver <CanalOficial cuentas={accounts} /> abajo.
// import { CanalOficial } from './oficial'

export const dynamic = 'force-dynamic'

const ESTADOS: Record<string, { label: string; badge: string }> = {
  connected: { label: 'Conectado', badge: 'b-green' },
  connecting: { label: 'Conectando…', badge: 'b-amber' },
  qr_pending: { label: 'Esperando escaneo', badge: 'b-blue' },
  disconnected: { label: 'Desconectado', badge: 'b-gray' },
  logged_out: { label: 'Sesión cerrada', badge: 'b-red' },
  banned: { label: 'Número bloqueado', badge: 'b-red' },
}

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  const { r, m } = await searchParams
  const etiqueta = etiquetaDe(session)
  const accounts = await getWhatsAppAccounts(session)
  // Las tarjetas con QR son solo del canal no oficial. Una cuenta oficial no
  // tiene código que escanear ni sesión que reconectar: se administra en su
  // propia sección.
  /**
   * La conexión por código QR queda ESCONDIDA, no borrada.
   *
   * Es una librería no oficial y va contra los términos de Meta: el número se
   * puede bloquear, y ya nos pasó. Con el canal oficial andando por Zernio no
   * hay motivo para ofrecerle ese riesgo a un cliente.
   *
   * El worker, la sesión en Postgres y toda la ruta siguen en su lugar y
   * funcionando: una cuenta que HOY esté conectada por QR se sigue viendo y
   * se puede administrar. Lo que desaparece es la invitación a crear una
   * nueva. Para volver a ofrecerlo, poner MOSTRAR_QR en true.
   */
  const MOSTRAR_QR = false
  const porQr = MOSTRAR_QR
    ? accounts.filter((a) => a.provider !== 'cloud_api' && a.provider !== 'zernio')
    : []
  // Una cuenta de QR ya conectada NO se esconde: esconderla dejaría a alguien
  // con un número andando y sin ninguna pantalla para desconectarlo.
  const qrExistentes = accounts.filter(
    (a) =>
      a.provider !== 'cloud_api' &&
      a.provider !== 'zernio' &&
      a.provider !== 'mock' &&
      a.status !== 'logged_out',
  )
  const puedeGestionar = session.role !== 'agent'
  // Mientras negocia, la pantalla se refresca sola para que aparezca el QR.
  const negociando = (MOSTRAR_QR ? porQr : qrExistentes).some(
    (a) => a.status === 'connecting' || a.status === 'qr_pending',
  )

  return (
    <>
      <AutoRefresh activo={negociando} />
      {m ? (
        <div
          className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
          style={{ marginBottom: 16 }}
        >
          <span>{m}</span>
        </div>
      ) : null}
      <div className="page-head">
        <p style={{ marginTop: 0 }}>
          Conectá el número {delRubro(etiqueta)} por la vía oficial de Meta
        </p>
      </div>

      {puedeGestionar && (
        <CanalZernio cuentas={accounts} disponible={zernioActivo()} />
      )}

      {MOSTRAR_QR && porQr.length === 0 && (
        <div className="panel-box">
          <div className="empty">
            <b>Conexión por código QR</b>
            La alternativa, si no querés usar la vía oficial. Al conectar vas a
            ver un código para escanear desde el celular {delRubro(etiqueta)},
            con WhatsApp → Dispositivos vinculados. Tené en cuenta que{' '}
            <strong>WhatsApp puede bloquear el número</strong> por conectarse
            así.
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

      {(MOSTRAR_QR ? porQr : qrExistentes).map((acc) => {
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
                  {/* Con el número bloqueado NO se ofrece reconectar. Cada
                      intento contra una cuenta restringida alarga el castigo,
                      y el botón invita justo a eso. */}
                  {acc.status !== 'connected' && acc.status !== 'banned' && (
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
                  {/* Borrar la sesión tiene que poder hacerse SIEMPRE, no solo
                      con el número conectado: es la salida de una sesión rota,
                      y es justo cuando está rota que no se puede conectar. */}
                  {acc.status !== 'logged_out' && (
                    <form action={disconnectWhatsApp}>
                      <input type="hidden" name="accountId" value={acc.id} />
                      <button type="submit" className="btn btn-ghost btn-sm">
                        {acc.status === 'connected'
                          ? 'Desconectar'
                          : 'Borrar sesión'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>

            <div className="panel-box-body">
              {acc.status === 'banned' && (
                <div className="alert alert-red" style={{ marginBottom: 14 }}>
                  <span>
                    <strong>WhatsApp restringió este número.</strong> Casi
                    siempre es temporal —de unas horas a unos días— y se
                    levanta solo. Desde el celular, en el aviso que muestra
                    WhatsApp, se puede pedir la revisión.
                    <br />
                    <br />
                    Mientras tanto, <strong>no reconectes</strong>: cada
                    intento contra una cuenta restringida alarga el castigo.
                    Esperá a que el teléfono vuelva a funcionar normalmente y
                    recién ahí volvé a vincular.
                  </span>
                </div>
              )}

              {acc.lastError && acc.status !== 'banned' && (
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
                    <li>1. Abrí WhatsApp en el celular {delRubro(etiqueta)}</li>
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

      {/* {puedeGestionar && <CanalOficial cuentas={accounts} />} */}

    </>
  )
}
