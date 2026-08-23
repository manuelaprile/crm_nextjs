import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'
import { modoPruebaActivo } from '@/lib/pruebas'
import { misConsultorios, volverAPlataforma } from '@/lib/usuarios'
import { Sidebar } from './sidebar'

export const dynamic = 'force-dynamic'

/**
 * Estructura del panel.
 *
 * Hay dos formas legítimas de estar acá adentro:
 *
 *  - **Con consultorio.** El caso normal: bandeja, contactos, reportes y
 *    configuración de ESE consultorio.
 *
 *  - **Superadmin sin consultorio.** Solo ve Plataforma: cuántos clientes
 *    hay, cuántos contactos y conversaciones tiene cada uno, y cuánto gastó
 *    de IA. Números agregados, nunca datos de pacientes.
 *
 * Que un superadmin NO pertenezca a ningún consultorio es lo deseable. Cuando
 * necesita entrar a uno lo hace desde Plataforma → «Entrar»: eso NO lo agrega
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

  const sinConsultorio = !session.tenantId || !session.role

  // Un superadmin sin consultorio no está roto: tiene su propia vista.
  if (sinConsultorio && !session.isSuperadmin) {
    return (
      <main className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em' }}>
            Sin consultorio asignado
          </h1>
          <p className="muted tiny" style={{ marginTop: 8 }}>
            Tu usuario todavía no está vinculado a ningún consultorio. Pedile
            a quien administra el sistema que te dé acceso.
          </p>
        </div>
      </main>
    )
  }

  // El contador de no leídos sale de una columna, no de un COUNT por fila.
  const unread =
    sinConsultorio || !session.tenantId || !session.role
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

  // Consultorios propios: los que el usuario tiene en `tenant_users`.
  const propios = await misConsultorios()

  // Una VISITA es un superadmin parado adentro de un consultorio del que no es
  // miembro. Es legítimo —entró a dar soporte— pero tiene que verse.
  const esVisita =
    session.isSuperadmin &&
    !!session.tenantId &&
    !propios.some((c) => c.id === session.tenantId)

  return (
    <div id="panel">
      <Sidebar
        tenantName={session.tenantName ?? 'Plataforma'}
        userName={session.name}
        role={session.role ?? 'agent'}
        unread={unread}
        modoPrueba={pruebas && !sinConsultorio && session.role !== 'agent'}
        esSuperadmin={session.isSuperadmin}
        sinConsultorio={sinConsultorio}
        consultorios={propios.map((c) => ({ id: c.id, nombre: c.nombre }))}
        esVisita={esVisita}
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
  )
}
