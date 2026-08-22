/**
 * Autenticación por sesión en base.
 *
 * Es el mismo modelo que las sesiones de PHP: la cookie lleva un identificador
 * aleatorio y todo el estado vive del lado del servidor. Se eligió esto y no un
 * JWT porque una sesión en base **se puede revocar**: si a la secretaria le
 * roban el celular, se borra la fila y la sesión muere en el acto. Un JWT
 * firmado sigue siendo válido hasta que expira, y no hay forma de matarlo.
 *
 * Propiedades de seguridad:
 *  - En la base se guarda el SHA-256 del token, no el token. Leer la tabla no
 *    alcanza para hacerse pasar por nadie.
 *  - Cookie httpOnly + secure + sameSite=lax: no la puede leer el JavaScript
 *    del navegador, y no viaja en requests cross-site.
 *  - El token se ROTA en cada login (evita fijación de sesión).
 *  - 5 intentos fallidos en 15 minutos bloquean, contando por email Y por IP.
 *  - La verificación de contraseña ocurre dentro de Postgres: la app nunca
 *    llega a ver el hash.
 */
import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import { withoutTenant, type TenantRole } from './db/client'

const COOKIE = 'crm_session'
const SESSION_DAYS = 7
/** Cada cuánto refrescamos last_used_at (evita un UPDATE por request). */
const TOUCH_EVERY_MS = 5 * 60 * 1000

export type Session = {
  userId: string
  email: string
  name: string
  isSuperadmin: boolean
  tenantId: string | null
  role: TenantRole | null
  tenantName: string | null
  tenantVertical: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function clientIp(): Promise<string | null> {
  const h = await headers()
  // Caddy manda X-Forwarded-For. Nos quedamos con la primera IP, que es la del
  // cliente real; el resto son proxies. Si algún día hay otro proxy delante,
  // esto hay que revisarlo: un X-Forwarded-For confiable es el que agrega
  // NUESTRO proxy, no el que manda el cliente.
  const xff = h.get('x-forwarded-for')
  const ip = xff?.split(',')[0]?.trim()
  return ip || null
}

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------

export type LoginResult =
  | { ok: true }
  | { ok: false; error: 'credenciales' | 'bloqueado' }

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const ip = await clientIp()
  const normalized = email.trim().toLowerCase()

  return withoutTenant(async (tx) => {
    const blocked = await tx.execute(
      sql`select login_is_blocked(${normalized}, ${ip}::inet) as blocked`,
    )
    if (blocked.rows[0]?.blocked === true) {
      return { ok: false as const, error: 'bloqueado' as const }
    }

    const found = await tx.execute(
      sql`select * from verify_login(${normalized}, ${password})`,
    )
    const user = found.rows[0] as
      | { id: string; email: string; name: string; is_superadmin: boolean }
      | undefined

    await tx.execute(
      sql`insert into login_attempts (email, ip, success)
          values (${normalized}, ${ip}::inet, ${Boolean(user)})`,
    )

    if (!user) return { ok: false as const, error: 'credenciales' as const }

    // Primer consultorio del usuario. Si tiene varios, después puede cambiar.
    // Va por función security definer: `tenant_users` tiene RLS que exige un
    // app.tenant_id que todavía no podemos saber. Ver 0005_session_context.sql.
    const memberships = await tx.execute(
      sql`select first_tenant_for(${user.id}) as tenant_id`,
    )
    const tenantId = (memberships.rows[0]?.tenant_id as string) ?? null

    // Token nuevo en cada login: rotación contra fijación de sesión.
    const token = randomBytes(32).toString('base64url')
    const ua = (await headers()).get('user-agent')?.slice(0, 500) ?? null

    await tx.execute(
      sql`insert into sessions (token_hash, user_id, tenant_id, ip, user_agent, expires_at)
          values (${hashToken(token)}, ${user.id}, ${tenantId}, ${ip}::inet, ${ua},
                  now() + ${`${SESSION_DAYS} days`}::interval)`,
    )
    await tx.execute(
      sql`update users set last_login_at = now() where id = ${user.id}`,
    )

    const jar = await cookies()
    jar.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    })

    return { ok: true as const }
  })
}

export async function logout(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (token) {
    await withoutTenant((tx) =>
      tx.execute(sql`delete from sessions where token_hash = ${hashToken(token)}`),
    )
  }
  jar.delete(COOKIE)
}

// ---------------------------------------------------------------------
// Lectura de la sesión actual
// ---------------------------------------------------------------------

export async function getSession(): Promise<Session | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null

  return withoutTenant(async (tx) => {
    // Función security definer: sin contexto de tenant, RLS esconde
    // `tenant_users` y `tenants`, y no se puede saber el contexto sin ellas.
    // Ver 0005_session_context.sql.
    const res = await tx.execute(
      sql`select * from resolve_session(${hashToken(token)})`,
    )
    const row = res.rows[0] as Record<string, unknown> | undefined
    if (!row) return null

    // Refresco perezoso de last_used_at.
    const lastUsed = new Date(String(row.last_used_at)).getTime()
    if (Date.now() - lastUsed > TOUCH_EVERY_MS) {
      await tx.execute(
        sql`update sessions set last_used_at = now()
            where token_hash = ${hashToken(token)}`,
      )
    }

    return {
      userId: String(row.user_id),
      email: String(row.email),
      name: String(row.name),
      isSuperadmin: Boolean(row.is_superadmin),
      tenantId: row.tenant_id ? String(row.tenant_id) : null,
      role: (row.role as TenantRole | null) ?? null,
      tenantName: row.tenant_name ? String(row.tenant_name) : null,
      tenantVertical: row.tenant_vertical ? String(row.tenant_vertical) : null,
    }
  })
}

/**
 * Sesión con consultorio activo. Es lo que consumen las páginas del panel:
 * devuelve el contexto listo para pasarle a `withTenant()`.
 */
export async function requireTenant(): Promise<
  Session & { tenantId: string; role: TenantRole }
> {
  const session = await getSession()
  if (!session) throw new AuthError('sin-sesion')
  if (!session.tenantId || !session.role) throw new AuthError('sin-consultorio')
  return session as Session & { tenantId: string; role: TenantRole }
}

/** Para acciones que solo puede hacer el dueño o un administrador. */
export async function requireAdmin() {
  const session = await requireTenant()
  if (session.role === 'agent') throw new AuthError('sin-permiso')
  return session
}

export class AuthError extends Error {
  constructor(public readonly kind: 'sin-sesion' | 'sin-consultorio' | 'sin-permiso') {
    super(kind)
  }
}

/** Comparación de secretos en tiempo constante (para los bearer internos). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
