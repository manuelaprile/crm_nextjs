import 'server-only'
import { sql } from 'drizzle-orm'
import { withTenant } from './db/client'
import { requireTenant } from './auth'
import { moduloActivo } from './modulos'

/**
 * Lecturas de Campañas.
 *
 * TODA función de acá empieza por `puertaDelModulo()`. La pantalla ya
 * devuelve 404 sin el módulo, pero una acción de servidor se puede invocar
 * sola: la puerta tiene que estar en cada camino, no solo en el que dibuja
 * el menú.
 */

export const MAX_MENSAJE = 1000
export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024

export type Filtros = { etapas: string[]; etiquetas: string[] }
export type Destino = 'todos' | 'filtros' | 'manual'

export type Campana = {
  id: string
  nombre: string
  estado: string
  destino: Destino
  filtros: Filtros
  mensaje: string
  tieneImagen: boolean
  elegidos: string[]
  actualizada: string
}

/**
 * El módulo, verificado del lado del servidor.
 *
 * Devuelve la sesión para no pedirla dos veces. Lanza si la cuenta no tiene
 * el módulo: acá no hay nada que degradar con elegancia, o se puede o no.
 */
export async function puertaDelModulo() {
  const session = await requireTenant()
  if (!(await moduloActivo('modulo:campanas', session.tenantId))) {
    throw new Error('modulo-no-contratado')
  }
  return session
}

/** Filtros que vienen de un jsonb: nunca se confía en la forma guardada. */
export function leerFiltros(valor: unknown): Filtros {
  const f = (valor ?? {}) as { etapas?: unknown; etiquetas?: unknown }
  const lista = (x: unknown) =>
    Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []
  return { etapas: lista(f.etapas), etiquetas: lista(f.etiquetas) }
}

export async function listarCampanas(): Promise<Campana[]> {
  const session = await puertaDelModulo()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select c.id, c.nombre, c.estado, c.destino, c.filtros, c.mensaje,
             c.imagen is not null as tiene_imagen,
             to_char(c.updated_at, 'DD/MM/YYYY HH24:MI') as actualizada,
             coalesce(
               (select array_agg(cc.contact_id::text)
                  from campana_contactos cc where cc.campana_id = c.id),
               '{}') as elegidos
        from campanas c
       order by c.updated_at desc
       limit 100
    `)
    return (res.rows as Record<string, unknown>[]).map(fila)
  })
}

export async function verCampana(id: string): Promise<Campana | null> {
  const session = await puertaDelModulo()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select c.id, c.nombre, c.estado, c.destino, c.filtros, c.mensaje,
             c.imagen is not null as tiene_imagen,
             to_char(c.updated_at, 'DD/MM/YYYY HH24:MI') as actualizada,
             coalesce(
               (select array_agg(cc.contact_id::text)
                  from campana_contactos cc where cc.campana_id = c.id),
               '{}') as elegidos
        from campanas c
       where c.id = ${id}::uuid
    `)
    const f = res.rows[0] as Record<string, unknown> | undefined
    return f ? fila(f) : null
  })
}

function fila(r: Record<string, unknown>): Campana {
  return {
    id: String(r.id),
    nombre: String(r.nombre),
    estado: String(r.estado),
    destino: (String(r.destino) as Destino) ?? 'todos',
    filtros: leerFiltros(r.filtros),
    mensaje: String(r.mensaje ?? ''),
    tieneImagen: Boolean(r.tiene_imagen),
    elegidos: Array.isArray(r.elegidos) ? (r.elegidos as string[]) : [],
    actualizada: String(r.actualizada ?? ''),
  }
}

/**
 * A cuántos contactos le llegaría, con estos filtros.
 *
 * Cuenta en la base y no en el navegador: la lista puede tener miles y bajar
 * todos los contactos para contarlos de este lado sería absurdo. Y es LA
 * MISMA consulta que va a resolver el envío el día que exista, así que el
 * número que se muestra no puede diferir del que sale.
 *
 * Solo cuenta los que tienen teléfono: a un contacto sin teléfono no hay por
 * dónde mandarle un WhatsApp, y contarlo infla el número que el cliente usa
 * para decidir.
 */
export async function contarAlcance(
  destino: Destino,
  filtros: Filtros,
  elegidos: string[],
): Promise<number> {
  const session = await puertaDelModulo()
  if (destino === 'manual') return elegidos.length

  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select count(distinct c.id)::int as n
        from contacts c
       where c.archived_at is null
         and c.phone is not null
         and (${destino !== 'filtros' || filtros.etapas.length === 0}
              or c.stage_id = any(${filtros.etapas}::uuid[]))
         and (${destino !== 'filtros' || filtros.etiquetas.length === 0}
              or exists (select 1 from contact_tags ct
                          where ct.contact_id = c.id
                            and ct.tag_id = any(${filtros.etiquetas}::uuid[])))
    `)
    return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0)
  })
}

export type ContactoElegible = {
  id: string
  nombre: string
  telefono: string | null
}

/**
 * Buscar contactos para elegirlos a mano.
 *
 * Con paginación, no con un `limit 500` y a ver qué pasa: la lista de un
 * cliente con dos años de uso no entra en una pantalla ni en una respuesta
 * razonable. Sin acentos, como el resto del buscador del panel.
 */
export async function buscarElegibles(
  texto: string,
  pagina: number,
): Promise<{ filas: ContactoElegible[]; total: number; paginas: number }> {
  const session = await puertaDelModulo()
  const porPagina = 20
  const offset = Math.max(0, pagina - 1) * porPagina
  const q = texto.trim() || null

  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select id, display_name, phone, count(*) over () as total
        from contacts
       where archived_at is null
         and phone is not null
         and (${q}::text is null
              or inmutable_unaccent(display_name)
                 ilike inmutable_unaccent('%' || ${q} || '%')
              or phone ilike '%' || ${q} || '%')
       order by display_name
       limit ${porPagina} offset ${offset}
    `)
    const rows = res.rows as Record<string, unknown>[]
    const total = rows.length ? Number(rows[0]!.total) : 0
    return {
      filas: rows.map((r) => ({
        id: String(r.id),
        nombre: String(r.display_name),
        telefono: r.phone ? String(r.phone) : null,
      })),
      total,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
    }
  })
}
