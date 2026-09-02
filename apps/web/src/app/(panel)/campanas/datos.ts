import 'server-only'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/client'
import { puertaDelModulo } from '@/lib/campanas'

/**
 * Con qué se arman los filtros del compositor: las etapas de esta cuenta y
 * las etiquetas que alguien usó de verdad.
 *
 * Las etiquetas se sacan de `contact_tags` y no de `tags`: ofrecer para
 * filtrar una etiqueta que no tiene ni un contacto da siempre cero
 * destinatarios y parece que el filtro está roto.
 */
export type OpcionesDeFiltro = {
  etapas: { id: string; nombre: string }[]
  etiquetas: { id: string; nombre: string }[]
  total: number
}

export async function opcionesDeFiltro(): Promise<OpcionesDeFiltro> {
  const session = await puertaDelModulo()
  return withTenant(session, async (tx) => {
    const et = await tx.execute(
      sql`select id, name from stages order by position`,
    )
    const tg = await tx.execute(sql`
      select t.id, t.name
        from tags t
        join contact_tags ct on ct.tag_id = t.id
        join contacts c on c.id = ct.contact_id and c.archived_at is null
       group by t.id, t.name
       order by t.name
       limit 50
    `)
    const tot = await tx.execute(sql`
      select count(*)::int as n from contacts
       where archived_at is null and phone is not null
    `)
    return {
      etapas: (et.rows as { id: string; name: string }[]).map((r) => ({
        id: String(r.id),
        nombre: String(r.name),
      })),
      etiquetas: (tg.rows as { id: string; name: string }[]).map((r) => ({
        id: String(r.id),
        nombre: String(r.name),
      })),
      total: Number((tot.rows[0] as { n: number } | undefined)?.n ?? 0),
    }
  })
}
