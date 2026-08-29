import 'server-only'

/**
 * Quién atiende cada conversación: las consultas.
 *
 * Leer quién la tiene y quién la tuvo lo puede hacer cualquiera de la cuenta:
 * saber que un hilo ya tiene dueño es justo lo que evita que dos personas
 * contesten el mismo mensaje. Derivar es otra cosa y vive en
 * `asignacion-acciones.ts`, porque es un permiso y no una consulta.
 *
 * La asignación va en la conversación, no en el contacto (regla 2 de
 * CLAUDE.md). La misma persona puede tener un hilo por WhatsApp y otro por
 * Instagram, y no tienen por qué caerle al mismo.
 */
import { sql } from 'drizzle-orm'
import { withTenant, type TenantContext } from './db/client'

export type UsuarioAsignable = {
  id: string
  nombre: string
  rol: string
  /** Para no ofrecer a alguien que ya no entra, sin perder su nombre del historial. */
  deshabilitado: boolean
}

/**
 * Los compañeros de cuenta, para el selector y para el filtro.
 *
 * Los superadministradores NO aparecen, por lo mismo que no aparecen en la
 * pantalla de usuarios: son de la plataforma, no del negocio. Derivarle una
 * consulta al que te vendió el sistema no es algo que quieras poder hacer
 * de un clic.
 */
export async function usuariosDeLaCuenta(
  ctx: TenantContext,
): Promise<UsuarioAsignable[]> {
  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select tu.user_id, tu.role, u.name, u.disabled_at
        from tenant_users tu
        join users u on u.id = tu.user_id
       where u.is_superadmin = false
       order by u.disabled_at nulls first, u.name
    `)
    return (res.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.user_id),
      nombre: String(r.name),
      rol: String(r.role),
      deshabilitado: Boolean(r.disabled_at),
    }))
  })
}

export type CambioDeResponsable = {
  id: number
  de: string | null
  a: string | null
  porQuien: string | null
  porIa: boolean
  cuando: string
}

/** Quién pasó esta conversación a quién. Lo ve toda la cuenta. */
export async function historialDeAsignacion(
  ctx: TenantContext,
  conversationId: string,
  limite = 6,
): Promise<CambioDeResponsable[]> {
  return withTenant(ctx, async (tx) => {
    const res = await tx.execute(sql`
      select ca.id, ca.by_ai, ca.created_at,
             ua.name as de, ub.name as a, uc.name as por_quien
        from conversation_assignments ca
   left join users ua on ua.id = ca.from_user_id
   left join users ub on ub.id = ca.to_user_id
   left join users uc on uc.id = ca.changed_by
       where ca.conversation_id = ${conversationId}
       order by ca.created_at desc
       limit ${limite}
    `)
    return (res.rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      de: r.de ? String(r.de) : null,
      a: r.a ? String(r.a) : null,
      porQuien: r.por_quien ? String(r.por_quien) : null,
      porIa: Boolean(r.by_ai),
      cuando: String(r.created_at),
    }))
  })
}
