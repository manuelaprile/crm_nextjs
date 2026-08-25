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
            La vía oficial de Meta: el número no se puede bloquear por usar
            una conexión no autorizada. Se conecta desde una ventana de
            Facebook, sin ningún código que escanear.
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
        ) : null}

        {!disponible && (
          <div className="alert alert-amber" style={{ marginBottom: 14 }}>
            Falta configurar la clave del proveedor en el servidor
            (<span className="mono">ZERNIO_API_KEY</span>).
          </div>
        )}

        {/*
          Los dos caminos, a la vista y con el REQUISITO adelante.

          Antes el botón decía "Conectar WhatsApp" a secas y el requisito
          —que el número ya tenga WhatsApp Business— estaba escondido adentro
          de un desplegable y redactado al revés. El resultado es que se
          elige mal, y elegir mal no da un error claro: Meta contesta "este
          número ya está registrado" o falla creando el perfil, y desde
          afuera parece que el sistema está roto.

          La pregunta ordena la decisión: qué hay HOY en el celular.
        */}
        <p style={{ marginTop: 0, marginBottom: 12, fontWeight: 600 }}>
          ¿El número que querés conectar ya tiene WhatsApp Business en el
          celular?
        </p>

        <form
          action={conectarZernio}
          style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr' }}
        >
          <div
            style={{
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-md)',
              padding: 14,
            }}
          >
            <p style={{ marginTop: 0, marginBottom: 4, fontWeight: 600 }}>
              Sí, está en WhatsApp Business
            </p>
            <p className="tiny muted" style={{ marginTop: 0, marginBottom: 10 }}>
              <strong>Recomendado.</strong> El número{' '}
              <strong>sigue funcionando en el celular</strong> como siempre, y
              además los mensajes entran acá. El código de verificación llega{' '}
              <strong>adentro de la app de WhatsApp Business</strong>, no por
              SMS.
            </p>
            <button
              type="submit"
              name="modo"
              value="coexistencia"
              className="btn btn-primary btn-sm"
              disabled={!disponible}
            >
              Conectar conservando la app
            </button>
          </div>

          <div
            style={{
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-md)',
              padding: 14,
            }}
          >
            <p style={{ marginTop: 0, marginBottom: 4, fontWeight: 600 }}>
              No, es una línea sin WhatsApp
            </p>
            <p className="tiny muted" style={{ marginTop: 0, marginBottom: 10 }}>
              Para un número dedicado {delRubro(etiqueta)}. Queda funcionando{' '}
              <strong>solo dentro del CRM</strong>: no se va a poder usar desde
              la aplicación del teléfono. Si ese número hoy tiene WhatsApp, hay
              que borrar esa cuenta primero. El código llega por SMS o llamada.
            </p>
            <button
              type="submit"
              name="modo"
              value="api"
              className="btn btn-ghost btn-sm"
              disabled={!disponible}
            >
              Conectar como línea dedicada
            </button>
          </div>
        </form>

        <p className="tiny muted" style={{ marginTop: 12 }}>
          Elegir la opción equivocada no avisa claro: Meta responde que el
          número ya está registrado, o falla al crear el perfil. Si te pasa,
          revisá primero cuál de las dos corresponde.
        </p>
      </div>
    </div>
  )
}
