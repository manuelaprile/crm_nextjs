'use server'

/**
 * Gestión de usuarios del consultorio (owner/admin) y del panel de
 * superadministración (solo superadmin).
 *
 * Reglas de permisos, todas verificadas del lado del servidor:
 *  - Un `agent` no puede ver ni tocar esta pantalla.
 *  - Un `admin` gestiona usuarios pero NO puede crear otro `owner`.
 *  - Nadie puede quitarse a sí mismo el propio acceso: sin esa regla, un
 *    dueño distraído se deja afuera de su propio consultorio.
 *  - `is_superadmin` NO se puede otorgar desde acá. Solo por el script de
 *    línea de comandos, que exige acceso al servidor.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin, getSession } from './auth'
import type { TenantRole } from './db/client'
import { withTenant, withoutTenant } from './db/client'

export type UsuarioDelConsultorio = {
  userId: string
  email: string
  name: string
  role: TenantRole
  esSuperadmin: boolean
  ultimoIngreso: string | null
  deshabilitado: boolean
  soyYo: boolean
}

export type PaginaUsuarios = {
  filas: UsuarioDelConsultorio[]
  total: number
  pagina: number
  porPagina: number
  paginas: number
}

/**
 * Usuarios del consultorio, paginados.
 *
 * Hoy son dos o tres y la paginación parece de más. Se hace igual porque
 * agregarla después, con la pantalla ya en uso, siempre cuesta más — y
 * porque un consultorio con varias sucursales puede llegar a veinte.
 */
export async function listarUsuarios(
  opts: { pagina?: number; porPagina?: number; buscar?: string } = {},
): Promise<PaginaUsuarios> {
  const session = await requireAdmin()
  const porPagina = Math.min(100, Math.max(10, opts.porPagina ?? 25))
  const pagina = Math.max(1, opts.pagina ?? 1)
  const offset = (pagina - 1) * porPagina
  const buscar = opts.buscar?.trim() || null

  return withTenant(session, async (tx) => {
    // `tenant_users` está protegida por RLS; `users` no lleva tenant_id, así
    // que el join se apoya en el filtro de la primera.
    const res = await tx.execute(sql`
      select tu.user_id, tu.role, u.email, u.name, u.is_superadmin,
             u.last_login_at, u.disabled_at,
             count(*) over () as total
        from tenant_users tu
        join users u on u.id = tu.user_id
       where (${buscar}::text is null
              or inmutable_unaccent(u.name) ilike inmutable_unaccent('%' || ${buscar} || '%')
              or u.email ilike '%' || ${buscar} || '%')
       order by tu.role, u.name
       limit ${porPagina} offset ${offset}
    `)
    const rows = res.rows as Record<string, unknown>[]
    const total = rows.length ? Number(rows[0]!.total) : 0

    return {
      filas: rows.map((r) => ({
        userId: String(r.user_id),
        email: String(r.email),
        name: String(r.name),
        role: r.role as TenantRole,
        esSuperadmin: Boolean(r.is_superadmin),
        ultimoIngreso: r.last_login_at ? String(r.last_login_at) : null,
        deshabilitado: Boolean(r.disabled_at),
        soyYo: String(r.user_id) === session.userId,
      })),
      total,
      pagina,
      porPagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
    }
  })
}

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(`/configuracion/usuarios?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`)
}

export async function crearUsuario(formData: FormData): Promise<void> {
  const session = await requireAdmin()

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
  const clave = String(formData.get('clave') ?? '')
  const rol = String(formData.get('rol') ?? 'agent') as TenantRole

  if (!email || !email.includes('@')) volver('error', 'El email no es válido.')
  if (!nombre) volver('error', 'Falta el nombre.')
  if (clave.length < 8) {
    volver('error', 'La contraseña tiene que tener al menos 8 caracteres.')
  }
  if (!['owner', 'admin', 'agent'].includes(rol)) {
    volver('error', 'Rol inválido.')
  }
  // Un admin no puede fabricar un dueño: sería escalar su propio permiso.
  if (rol === 'owner' && session.role !== 'owner') {
    volver('error', 'Solo el dueño puede crear otro dueño.')
  }

  // El límite del plan se controla acá, no en la interfaz.
  const lleno = await withTenant(session, async (tx) => {
    const r = await tx.execute(sql`
      select (select max_users from tenants where id = ${session.tenantId}) as max,
             (select count(*)::int from tenant_users) as usados
    `)
    const row = r.rows[0] as { max: number; usados: number }
    return row.usados >= row.max
  })
  if (lleno) {
    volver('error', 'Alcanzaste el límite de usuarios de tu plan.')
  }

  // TODO va dentro de withTenant: `tenant_users` y `audit_log` tienen RLS
  // que exige `tenant_id = app_tenant_id() and app_is_admin()`. Sin contexto
  // de consultorio el INSERT se rechaza con 42501 — que es exactamente lo que
  // pasaba. `users` no lleva tenant_id y no tiene RLS, así que se puede crear
  // desde acá adentro sin problema.
  await withTenant(session, async (tx) => {
    const existente = await tx.execute(
      sql`select id from users where email = ${email}`,
    )
    let userId: string
    if (existente.rows.length) {
      userId = String(existente.rows[0]!.id)
    } else {
      const nuevo = await tx.execute(sql`
        insert into users (email, name) values (${email}, ${nombre})
        returning id
      `)
      userId = String(nuevo.rows[0]!.id)
    }
    // El hash lo calcula Postgres: la app nunca ve ni guarda la contraseña.
    await tx.execute(sql`select set_user_password(${userId}, ${clave})`)
    await tx.execute(sql`
      insert into tenant_users (tenant_id, user_id, role)
      values (${session.tenantId}, ${userId}, ${rol})
      on conflict (tenant_id, user_id) do update set role = excluded.role
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
      values (${session.tenantId}, ${session.userId}, 'user.created', 'user',
              ${userId}, ${JSON.stringify({ email, rol })}::jsonb)
    `)
  })

  revalidatePath('/configuracion/usuarios')
  volver('ok', `${email} ya puede ingresar.`)
}

export async function cambiarRol(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const userId = String(formData.get('userId') ?? '')
  const rol = String(formData.get('rol') ?? '') as TenantRole

  if (!userId || !['owner', 'admin', 'agent'].includes(rol)) return
  if (userId === session.userId) {
    volver('error', 'No podés cambiarte el rol a vos mismo.')
  }
  if (rol === 'owner' && session.role !== 'owner') {
    volver('error', 'Solo el dueño puede nombrar a otro dueño.')
  }

  await withTenant(session, async (tx) => {
    await tx.execute(sql`
      update tenant_users set role = ${rol}
       where user_id = ${userId} and tenant_id = ${session.tenantId}
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
      values (${session.tenantId}, ${session.userId}, 'user.role_changed', 'user',
              ${userId}, ${JSON.stringify({ rol })}::jsonb)
    `)
  })
  revalidatePath('/configuracion/usuarios')
  volver('ok', 'Rol actualizado.')
}

export async function quitarUsuario(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const userId = String(formData.get('userId') ?? '')
  if (!userId) return

  if (userId === session.userId) {
    volver('error', 'No podés sacarte a vos mismo del consultorio.')
  }

  await withTenant(session, async (tx) => {
    const objetivo = await tx.execute(sql`
      select role from tenant_users
       where user_id = ${userId} and tenant_id = ${session.tenantId}
    `)
    if (!objetivo.rows.length) return
    if (objetivo.rows[0]!.role === 'owner' && session.role !== 'owner') {
      throw new Error('solo-owner')
    }

    await tx.execute(sql`
      delete from tenant_users
       where user_id = ${userId} and tenant_id = ${session.tenantId}
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId}, 'user.removed', 'user', ${userId})
    `)
  })

  // Sacarlo del consultorio tiene que cerrarle la sesión: si no, sigue
  // navegando con el tenant viejo hasta que expire la cookie.
  await withoutTenant((tx) =>
    tx.execute(sql`
      delete from sessions
       where user_id = ${userId} and tenant_id = ${session.tenantId}
    `),
  )

  revalidatePath('/configuracion/usuarios')
  volver('ok', 'Usuario quitado del consultorio.')
}

export async function resetearClave(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const userId = String(formData.get('userId') ?? '')
  const clave = String(formData.get('clave') ?? '')
  if (!userId) return
  if (clave.length < 8) {
    volver('error', 'La contraseña tiene que tener al menos 8 caracteres.')
  }

  const pertenece = await withTenant(session, async (tx) => {
    const r = await tx.execute(sql`
      select 1 from tenant_users
       where user_id = ${userId} and tenant_id = ${session.tenantId}
    `)
    return r.rows.length > 0
  })
  if (!pertenece) volver('error', 'Ese usuario no es de este consultorio.')

  await withoutTenant(async (tx) => {
    await tx.execute(sql`select set_user_password(${userId}, ${clave})`)
    await tx.execute(sql`delete from sessions where user_id = ${userId}`)
  })
  await withTenant(session, (tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId}, 'user.password_reset',
              'user', ${userId})
    `),
  )

  revalidatePath('/configuracion/usuarios')
  volver('ok', 'Contraseña cambiada. Se cerraron sus sesiones abiertas.')
}

// =====================================================================
// SUPERADMIN
// =====================================================================

export async function esSuperadmin(): Promise<boolean> {
  const session = await getSession()
  return Boolean(session?.isSuperadmin)
}

export type FilaConsultorio = {
  id: string
  slug: string
  name: string
  vertical: string
  status: string
  plan: string
  usuarios: number
  contactos: number
  conversaciones: number
  costoIaMes: string
  topeIa: string
  creado: string
}

/**
 * Vista global de la plataforma. Solo superadmin.
 *
 * Va por `withoutTenant` (sin contexto de consultorio) y por eso NO puede
 * leer las tablas con RLS. Los conteos salen de una función `security
 * definer` acotada a devolver números agregados: nunca datos de pacientes.
 */
export type PaginaConsultorios = {
  filas: FilaConsultorio[]
  total: number
  pagina: number
  porPagina: number
  paginas: number
}

export async function listarConsultorios(
  opts: { pagina?: number; porPagina?: number; buscar?: string } = {},
): Promise<PaginaConsultorios> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const porPagina = Math.min(100, Math.max(10, opts.porPagina ?? 25))
  const pagina = Math.max(1, opts.pagina ?? 1)
  const offset = (pagina - 1) * porPagina
  const buscar = opts.buscar?.trim() || null

  return withoutTenant(async (tx) => {
    const res = await tx.execute(sql`
      select *, count(*) over () as total from superadmin_resumen()
       where (${buscar}::text is null
              or inmutable_unaccent(name) ilike inmutable_unaccent('%' || ${buscar} || '%')
              or slug ilike '%' || ${buscar} || '%')
       limit ${porPagina} offset ${offset}
    `)
    const rows = res.rows as Record<string, unknown>[]
    const total = rows.length ? Number(rows[0]!.total) : 0
    const filas = rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      vertical: String(r.vertical),
      status: String(r.status),
      plan: String(r.plan),
      usuarios: Number(r.usuarios),
      contactos: Number(r.contactos),
      conversaciones: Number(r.conversaciones),
      costoIaMes: String(r.costo_ia_mes ?? '0'),
      topeIa: String(r.tope_ia ?? '0'),
      creado: String(r.created_at),
    }))

    return {
      filas,
      total,
      pagina,
      porPagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
    }
  })
}
