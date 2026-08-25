'use server'

/**
 * Usuarios de TODA la plataforma. Solo superadmin.
 *
 * Existe por un agujero concreto: los usuarios solo se veían desde adentro de
 * una cuenta, así que al sacar a alguien de la última a la que pertenecía,
 * desaparecía de todas las pantallas. Podía iniciar sesión —el panel le decía
 * que no está asignado a ningún lado— y no había forma de encontrarlo ni de
 * arreglarlo sin entrar a la base a mano.
 *
 * Todo pasa por funciones `security definer` (ver 0018_usuarios_plataforma.sql):
 * `tenant_users` tiene RLS que exige un `app.tenant_id`, y acá justamente se
 * mira a través de todas las cuentas.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getSession } from './auth'
import { withoutTenant } from './db/client'

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/superadmin/usuarios?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

async function tokenDeSesion(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get('crm_session')?.value
  return token ? createHash('sha256').update(token).digest('hex') : null
}

export type CuentaDeUsuario = {
  tenantId: string
  nombre: string
  slug: string
  rol: string
  estado: string
}

export type UsuarioPlataforma = {
  id: string
  email: string
  name: string
  esSuperadmin: boolean
  deshabilitado: boolean
  ultimoIngreso: string | null
  creado: string
  cuentas: CuentaDeUsuario[]
  soyYo: boolean
}

export type PaginaUsuariosPlataforma = {
  filas: UsuarioPlataforma[]
  total: number
  pagina: number
  porPagina: number
  paginas: number
  /** Cuántos no pertenecen a ninguna cuenta, en toda la plataforma. */
  huerfanos: number
}

export async function listarUsuariosPlataforma(
  opts: { pagina?: number; porPagina?: number; buscar?: string } = {},
): Promise<PaginaUsuariosPlataforma> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const porPagina = Math.min(100, Math.max(10, opts.porPagina ?? 25))
  const pagina = Math.max(1, opts.pagina ?? 1)
  const offset = (pagina - 1) * porPagina
  const buscar = opts.buscar?.trim() || null

  return withoutTenant(async (tx) => {
    const res = await tx.execute(
      sql`select * from superadmin_usuarios(${buscar}, ${porPagina}, ${offset})`,
    )
    const rows = res.rows as Record<string, unknown>[]
    const total = rows.length ? Number(rows[0]!.total) : 0

    // El conteo de sueltos es de TODA la plataforma, no de la página: un
    // aviso que solo cuenta lo que estás mirando no sirve de aviso.
    const h = await tx.execute(sql`
      select count(*)::int as n from users u
       where u.is_superadmin = false
         and not exists (select 1 from tenant_users tu where tu.user_id = u.id)
    `)

    return {
      filas: rows.map((r) => ({
        id: String(r.id),
        email: String(r.email),
        name: String(r.name),
        esSuperadmin: Boolean(r.is_superadmin),
        deshabilitado: Boolean(r.disabled_at),
        ultimoIngreso: r.last_login_at ? String(r.last_login_at) : null,
        creado: String(r.created_at),
        cuentas: (r.cuentas as CuentaDeUsuario[]) ?? [],
        soyYo: String(r.id) === session.userId,
      })),
      total,
      pagina,
      porPagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
      huerfanos: Number(h.rows[0]?.n ?? 0),
    }
  })
}

/** Sacar a alguien de UNA cuenta. El usuario sigue existiendo. */
export async function quitarDeCuenta(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const userId = String(formData.get('userId') ?? '')
  const tenantId = String(formData.get('tenantId') ?? '')
  const quien = String(formData.get('quien') ?? 'El usuario')
  const donde = String(formData.get('donde') ?? 'la cuenta')
  if (!userId || !tenantId) volver('error', 'Datos incompletos.')

  const hash = await tokenDeSesion()
  if (!hash) volver('error', 'Sesión vencida. Volvé a entrar.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_quitar_de_cuenta(${hash}, ${userId}::uuid,
                                              ${tenantId}::uuid) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })
  if (!ok) volver('error', 'No se pudo quitar al usuario de esa cuenta.')

  revalidatePath('/superadmin/usuarios')
  volver(
    'ok',
    `${quien} ya no pertenece a «${donde}». El usuario sigue existiendo.`,
  )
}

/**
 * Cortar o devolver el acceso. Es la baja reversible, y casi siempre la
 * correcta: el historial de quién hizo qué sigue con su nombre.
 */
export async function habilitarUsuario(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const userId = String(formData.get('userId') ?? '')
  const habilitar = String(formData.get('habilitar') ?? '') === 'si'
  const quien = String(formData.get('quien') ?? 'El usuario')
  if (!userId) volver('error', 'Datos incompletos.')

  const hash = await tokenDeSesion()
  if (!hash) volver('error', 'Sesión vencida. Volvé a entrar.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_habilitar_usuario(${hash}, ${userId}::uuid,
                                               ${habilitar}) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })
  if (!ok) {
    volver(
      'error',
      userId === session.userId
        ? 'No podés deshabilitarte a vos mismo: quedarías afuera sin forma de volver.'
        : 'No se pudo cambiar el acceso del usuario.',
    )
  }

  revalidatePath('/superadmin/usuarios')
  volver(
    'ok',
    habilitar
      ? `${quien} puede volver a entrar.`
      : `${quien} ya no puede entrar. No se borró nada: se puede rehabilitar.`,
  )
}

/**
 * Eliminar un usuario definitivamente.
 *
 * Pide escribir el mail, y ese mail se vuelve a comparar en Postgres. Además
 * de irreversible, deja sin autor las filas de auditoría que hizo esa
 * persona: casi siempre lo que se quiere es deshabilitar.
 */
export async function eliminarUsuario(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const userId = String(formData.get('userId') ?? '')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const confirmacion = String(formData.get('confirmacion') ?? '')
    .trim()
    .toLowerCase()
  if (!userId || !email) volver('error', 'Datos incompletos.')

  if (confirmacion !== email) {
    volver(
      'error',
      `Para eliminar hay que escribir «${email}» exactamente. No se borró nada.`,
    )
  }

  const hash = await tokenDeSesion()
  if (!hash) volver('error', 'Sesión vencida. Volvé a entrar.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_eliminar_usuario(${hash}, ${userId}::uuid, ${email}) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })
  if (!ok) {
    volver(
      'error',
      userId === session.userId
        ? 'No podés eliminarte a vos mismo.'
        : 'No se pudo eliminar. Si es otro superadministrador, se da de baja ' +
            'con «./crm.sh borrar usuario» desde el servidor.',
    )
  }

  revalidatePath('/superadmin/usuarios')
  volver('ok', `El usuario ${email} fue eliminado.`)
}
