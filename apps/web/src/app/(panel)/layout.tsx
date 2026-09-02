import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'
import { modoPruebaActivo } from '@/lib/pruebas'
import { misCuentas, volverAPlataforma } from '@/lib/usuarios'
import { etiquetaDe } from '@/lib/etiquetas'
import { getLogoVersion } from '@/lib/comercio'
import { moduloActivo } from '@/lib/modulos'
import { Sidebar } from './sidebar'
import { PulsoProvider } from './pulso-provider'

export const dynamic = 'force-dynamic'

/**
 * Estructura del panel.
 *
 * Hay dos formas legítimas de estar acá adentro:
 *
 *  - **Con cuenta activa.** El caso normal: bandeja, contactos, reportes y
 *    configuración de ESA cuenta.
 *
 *  - **Superadmin sin cuenta.** Solo ve Plataforma: cuántos clientes hay,
 *    cuántos contactos y conversaciones tiene cada uno, y cuánto gastó de IA.
 *    Números agregados, nunca datos de pacientes.
 *
 * Que un superadmin NO pertenezca a ninguna cuenta es lo deseable. Cuando
 * necesita entrar a una lo hace desde Plataforma → «Entrar»: eso NO lo agrega
 * a `tenant_users` (sigue sin ser miembro), pero escribe una fila en
 * `audit_log` y le deja una franja visible arriba mientras dure la visita.
 * No hay forma de mirar los datos de un paciente sin dejar rastro.
 */
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const sinCuenta = !session.tenantId || !session.role
  const etiqueta = etiquetaDe(session)

  // Un superadmin sin cuenta no está roto: tiene su propia vista.
  if (sinCuenta && !session.isSuperadmin) {
    return (
      <main className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em' }}>
            Sin acceso asignado
          </h1>
          <p className="muted tiny" style={{ marginTop: 8 }}>
            Tu usuario existe, pero todavía no está vinculado a ninguna cuenta.
            Pedile a quien administra el sistema que te dé acceso.
          </p>
        </div>
      </main>
    )
  }

  // El contador de no leídos sale de una columna, no de un COUNT por fila.
  const unread =
    sinCuenta || !session.tenantId || !session.role
      ? 0
      : await withTenant(
          {
            tenantId: session.tenantId,
            userId: session.userId,
            role: session.role,
          },
          async (tx) => {
            const res = await tx.execute(sql`
              select coalesce(sum(unread_count), 0)::int as n
                from conversations where archived_at is null
            `)
            return Number(res.rows[0]?.n ?? 0)
          },
        )

  const pruebas = await modoPruebaActivo()

  // Cuentas propias: las que el usuario tiene en `tenant_users`.
  const propias = await misCuentas()
  const logoVersion = sinCuenta ? null : await getLogoVersion()
  // Un módulo contratado. Sin cuenta no hay módulo que valga: el superadmin
  // suelto no tiene contactos a los que mandarle una campaña.
  const campanas =
    sinCuenta || !session.tenantId
      ? false
      : await moduloActivo('modulo-campanas', session.tenantId)

  // Una VISITA es un superadmin parado adentro de una cuenta de la que no es
  // miembro. Es legítimo —entró a dar soporte— pero tiene que verse.
  const esVisita =
    session.isSuperadmin &&
    !!session.tenantId &&
    !propias.some((c) => c.id === session.tenantId)

  return (
    /**
     * El latido envuelve TODO el panel, no la bandeja.
     *
     * Así no se desmonta al navegar —que era lo que perdía el estado del
     * aviso— y el número de sin leer del menú puede actualizarse en vivo sin
     * depender de que el layout se vuelva a renderizar en el servidor.
     */
    <PulsoProvider sinLeerInicial={unread}>
    <div id="panel">
      <Sidebar
        tenantName={session.tenantName ?? 'Plataforma'}
        userName={session.name}
        role={session.role ?? 'agent'}
        unread={unread}
        modoPrueba={pruebas && !sinCuenta && session.role !== 'agent'}
        esSuperadmin={session.isSuperadmin}
        sinCuenta={sinCuenta}
        cuentas={propias.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          rubro: c.rubro,
        }))}
        esVisita={esVisita}
        rubro={etiqueta.singular}
        logoVersion={logoVersion}
        campanas={campanas}
      />
      <div className="main">
        {esVisita ? (
          <div className="visita-banner">
            <span>
              Estás dentro de <strong>{session.tenantName}</strong> como
              superadministrador. Esta visita quedó registrada en la auditoría.
            </span>
            <form action={volverAPlataforma}>
              <button type="submit" className="btn btn-sm">
                Volver a Plataforma
              </button>
            </form>
          </div>
        ) : null}
        {children}
      </div>
    </div>
    </PulsoProvider>
  )
}
