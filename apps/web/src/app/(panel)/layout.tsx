import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'
import { modoPruebaActivo } from '@/lib/pruebas'
import { Sidebar } from './sidebar'

export const dynamic = 'force-dynamic'

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  if (!session.tenantId || !session.role) {
    return (
      <main className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em' }}>
            Sin consultorio asignado
          </h1>
          <p className="muted tiny" style={{ marginTop: 8 }}>
            Tu usuario todavía no está vinculado a ningún consultorio.
          </p>
        </div>
      </main>
    )
  }

  // El contador de no leídos sale de una columna, no de un COUNT por fila.
  const unread = await withTenant(
    { tenantId: session.tenantId, userId: session.userId, role: session.role },
    async (tx) => {
      const res = await tx.execute(sql`
        select coalesce(sum(unread_count), 0)::int as n
          from conversations where archived_at is null
      `)
      return Number(res.rows[0]?.n ?? 0)
    },
  )

  const pruebas = await modoPruebaActivo()

  return (
    <div id="panel">
      <Sidebar
        tenantName={session.tenantName ?? 'Consultorio'}
        userName={session.name}
        role={session.role}
        unread={unread}
        modoPrueba={pruebas && session.role !== 'agent'}
        esSuperadmin={session.isSuperadmin}
      />
      <div className="main">{children}</div>
    </div>
  )
}
