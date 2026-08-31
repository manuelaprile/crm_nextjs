'use server'

/**
 * Bajas de cuentas desde el panel de plataforma. Solo superadmin.
 *
 * Todo pasa por funciones `security definer` (ver 0017_baja_cuentas.sql): el
 * rol del panel no tiene permiso para escribir `status` ni para borrar un
 * tenant, y eso se mantiene así. Acá solo se valida la entrada y se traduce
 * el resultado a algo que se entienda en pantalla.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getSession } from './auth'
import { withoutTenant } from './db/client'

function hashCookie(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(`/superadmin?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`)
}

async function tokenDeSesion(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get('crm_session')?.value
  return token ? hashCookie(token) : null
}

const ESTADOS = ['trial', 'active', 'past_due', 'suspended', 'cancelled'] as const
type Estado = (typeof ESTADOS)[number]

/**
 * Suspender o reactivar. Reversible y sin pérdida de datos.
 *
 * Suspendida, la cuenta deja de recibir mensajes y sus usuarios no pueden
 * entrar al panel, pero todo lo que tiene sigue ahí intacto. Es lo que hay
 * que usar para un cliente que dejó de pagar: eliminar es para cuando ya no
 * queda nada que recuperar.
 */
export async function cambiarEstadoCuenta(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const tenantId = String(formData.get('tenantId') ?? '')
  const estado = String(formData.get('estado') ?? '') as Estado
  const nombre = String(formData.get('nombre') ?? 'La cuenta')

  if (!tenantId || !ESTADOS.includes(estado)) {
    volver('error', 'Datos incompletos.')
  }

  const hash = await tokenDeSesion()
  if (!hash) volver('error', 'Sesión vencida. Volvé a entrar.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_cambiar_estado(${hash}, ${tenantId}::uuid,
                                           ${estado}::tenant_status) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })

  if (!ok) {
    // El motivo más probable, y el único que la persona puede corregir.
    volver(
      'error',
      session.tenantId === tenantId
        ? `Estás adentro de «${nombre}». Salí a Plataforma primero: si la ` +
            'suspendieras desde adentro, perderías el acceso al panel.'
        : 'No se pudo cambiar el estado de la cuenta.',
    )
  }

  revalidatePath('/superadmin')
  volver(
    'ok',
    estado === 'suspended'
      ? `«${nombre}» quedó suspendida. No se borró nada: se puede reactivar.`
      : `«${nombre}» quedó ${estado === 'active' ? 'activa' : estado}.`,
  )
}

/**
 * Eliminar una cuenta y todos sus datos. No hay vuelta atrás.
 *
 * Pide escribir el slug, y ese slug viaja hasta la función de Postgres, que
 * lo vuelve a comparar. La confirmación no puede vivir solo en la pantalla:
 * un formulario reenviado o un doble clic no tienen pantalla.
 */
export async function eliminarCuenta(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const tenantId = String(formData.get('tenantId') ?? '')
  const slug = String(formData.get('slug') ?? '').trim()
  const confirmacion = String(formData.get('confirmacion') ?? '').trim()

  if (!tenantId || !slug) volver('error', 'Datos incompletos.')

  if (confirmacion !== slug) {
    volver(
      'error',
      `Para eliminar hay que escribir «${slug}» exactamente. No se borró nada.`,
    )
  }

  const hash = await tokenDeSesion()
  if (!hash) volver('error', 'Sesión vencida. Volvé a entrar.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_eliminar_cuenta(${hash}, ${tenantId}::uuid, ${slug}) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })

  if (!ok) {
    volver(
      'error',
      session.tenantId === tenantId
        ? 'Estás adentro de esa cuenta. Salí a Plataforma y volvé a intentar.'
        : 'No se pudo eliminar la cuenta.',
    )
  }

  revalidatePath('/superadmin')
  volver('ok', `La cuenta «${slug}» y todos sus datos fueron eliminados.`)
}

// =====================================================================
// PLAN Y LÍMITES
// =====================================================================

/**
 * Un número del formulario, o null si viene vacío.
 *
 * El campo vacío significa SIN TOPE, y hay que distinguirlo del cero. Un
 * `Number('')` da 0, que en `max_users` significaría "cero usuarios
 * permitidos" — o sea, la cuenta no puede crear a nadie. Es exactamente el
 * error que hay que evitar acá.
 */
function topeODefecto(v: FormDataEntryValue | null): number | null {
  const texto = String(v ?? '').trim()
  if (!texto) return null
  const n = Number(texto)
  return Number.isFinite(n) ? n : null
}

/**
 * Cambiar el plan de una cuenta y sus cuatro límites.
 *
 * Los cuatro viajan juntos y NINGUNO se deduce del nombre del plan: el
 * catálogo lo aplica la pantalla al elegir, y desde ahí se puede ajustar
 * cualquiera. Así "Start pero con 5 usuarios" es un cambio de un campo y no
 * un plan nuevo en el código.
 *
 * La escritura pasa por `superadmin_cambiar_plan` (0035). `crm_app` no tiene
 * permiso de update sobre esas columnas y no lo tiene que tener: es lo que
 * impide que un admin de una cuenta se suba su propio límite.
 */
export async function cambiarPlanCuenta(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session?.isSuperadmin) throw new Error('no autorizado')

  const tenantId = String(formData.get('tenantId') ?? '')
  const nombre = String(formData.get('nombre') ?? 'La cuenta')
  const plan = String(formData.get('plan') ?? '').trim()
  if (!tenantId || !plan) volver('error', 'Datos incompletos.')

  const maxUsuarios = topeODefecto(formData.get('maxUsuarios'))
  const maxNumeros = topeODefecto(formData.get('maxNumeros'))
  const cupoIa = topeODefecto(formData.get('cupoIa'))
  const topeGasto = topeODefecto(formData.get('topeGasto'))

  const hash = await tokenDeSesion()
  if (!hash) volver('error', 'Sesión vencida. Volvé a entrar.')

  const ok = await withoutTenant(async (tx) => {
    const r = await tx.execute(
      sql`select superadmin_cambiar_plan(
            ${hash}, ${tenantId}::uuid, ${plan},
            ${maxUsuarios}::int, ${maxNumeros}::int,
            ${cupoIa}::int, ${topeGasto}::numeric) as ok`,
    )
    return Boolean(r.rows[0]?.ok)
  })

  if (!ok) {
    volver(
      'error',
      'No se pudo cambiar el plan. Revisá que los números sean razonables ' +
        '(usuarios 1 a 10.000, números 1 a 100) o volvé a entrar.',
    )
  }

  revalidatePath('/superadmin')
  volver('ok', `«${nombre}» quedó en el plan ${plan}.`)
}
