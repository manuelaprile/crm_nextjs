import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { moduloActivo } from '@/lib/modulos'
import { getStages } from '@/lib/queries'
import { withTenant } from '@/lib/db/client'
import { sql } from 'drizzle-orm'
import { etiquetaDe } from '@/lib/etiquetas'
import { Compositor } from './compositor'

export const dynamic = 'force-dynamic'

/**
 * Campañas: un mensaje a varios contactos.
 *
 * PUERTA DEL MÓDULO. Que el ítem no aparezca en el menú es prolijidad, no
 * seguridad: cualquiera puede escribir /campanas en la barra de direcciones.
 * El `notFound()` de acá es lo que de verdad cierra la pantalla, y va del
 * lado del servidor.
 *
 * Se devuelve 404 y no un "no tenés este módulo" a propósito: para una cuenta
 * que no lo contrató, esta sección no existe. Un cartel que dice "esto se
 * compra aparte" en el medio del panel es publicidad adentro de una
 * herramienta de trabajo.
 */
export default async function CampanasPage() {
  const session = await requireTenant()
  if (!(await moduloActivo('modulo:campanas', session.tenantId))) notFound()

  const etiqueta = etiquetaDe(session)
  const etapas = await getStages(session)

  // Los contactos alcanzables y las etiquetas que existen, para armar los
  // filtros con lo que esta cuenta tiene de verdad y no con una lista fija.
  const { total, etiquetas } = await withTenant(session, async (tx) => {
    const t = await tx.execute(sql`
      select count(*)::int as n from contacts
       where archived_at is null and phone is not null
    `)
    // Solo las etiquetas que alguien usó. Ofrecer para filtrar una etiqueta
    // que no tiene ni un contacto da siempre cero destinatarios y parece que
    // el filtro está roto.
    const e = await tx.execute(sql`
      select t.id, t.name, count(ct.contact_id)::int as usos
        from tags t
        join contact_tags ct on ct.tag_id = t.id
        join contacts c on c.id = ct.contact_id and c.archived_at is null
       group by t.id, t.name
       order by t.name
       limit 50
    `)
    return {
      total: Number((t.rows[0] as { n: number } | undefined)?.n ?? 0),
      etiquetas: (e.rows as { id: string; name: string }[]).map((r) => ({
        id: String(r.id),
        nombre: String(r.name),
      })),
    }
  })

  return (
    <>
      <div className="topnav">
        <h2>Campañas</h2>
        <span className="badge b-gray mono">{total} alcanzables</span>
      </div>

      <div className="content">
        <Compositor
          etapas={etapas.map((e) => ({ id: e.id, nombre: e.name }))}
          etiquetas={etiquetas}
          totalContactos={total}
          rubro={etiqueta.plural}
        />
      </div>
    </>
  )
}
