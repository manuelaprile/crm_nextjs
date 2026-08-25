'use server'

/**
 * El alta de un número por Zernio: un botón.
 *
 * Todo el trámite de Meta lo pone Zernio, que ya está aprobado como Tech
 * Provider. Nosotros pedimos una URL de Facebook, mandamos ahí a la persona,
 * y cuando vuelve guardamos el id de la cuenta que quedó conectada.
 *
 * La conexión va en modo COEXISTENCE: el número sigue funcionando en la
 * aplicación de WhatsApp del celular. Es la diferencia grande con el alta
 * manual por Cloud API, donde registrar el número lo saca de la app.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant, withSystem } from './db/client'
import { profileDeTenant, urlDeConexion, zernioActivo } from './zernio'
import { cupoDeWhatsApp } from './cupo'

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/configuracion/whatsapp?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

/**
 * El origen público de esta instalación.
 *
 * Sale del request y NO de una variable de entorno: una URL mal puesta hace
 * que Facebook devuelva a la persona a ningún lado, sin un solo error visible.
 * Es la misma decisión que ya está anotada en el docker-compose.
 */
async function origen(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

export async function conectarZernio(): Promise<void> {
  const session = await requireAdmin()

  if (!zernioActivo()) {
    volver('error', 'Falta configurar ZERNIO_API_KEY en el servidor.')
  }

  // El límite del plan se respeta igual que en las otras dos altas.
  const cupo = await withTenant(session, async (tx) => {
    const yaEsta = await tx.execute(sql`
      select id from channel_accounts
       where channel = 'whatsapp' and provider = 'zernio' limit 1
    `)
    // Reconectar un número que ya está dado de alta no consume un lugar
    // nuevo: es el mismo.
    if (yaEsta.rows.length) return null
    return cupoDeWhatsApp(tx, session.tenantId)
  })
  if (cupo && !cupo.hayLugar) {
    // El mensaje tiene que decir QUÉ HACER. "Alcanzaste el límite" a secas,
    // en una pantalla sin ningún botón para liberar lugar, es un callejón
    // sin salida — y el caso típico es justamente este: alguien que viene
    // del QR y quiere pasarse acá.
    volver(
      'error',
      `Tu plan permite ${cupo.max} número(s) y ya tenés ${cupo.usados} en uso. ` +
        'Si es el número viejo del código QR, tocá «Borrar sesión» en su ' +
        'tarjeta y volvé a intentar: las conversaciones no se pierden.',
    )
  }

  const nombre = await withSystem(async (tx) => {
    const res = await tx.execute(
      sql`select name from tenants where id = ${session.tenantId}`,
    )
    return String(res.rows[0]?.name ?? 'Cuenta')
  })

  const profile = await profileDeTenant(session.tenantId, nombre)
  if (!profile.ok) {
    volver('error', `No se pudo preparar la conexión: ${profile.error}`)
  }

  const url = await urlDeConexion({
    profileId: profile.data,
    redirectUrl: `${await origen()}/api/zernio/callback`,
  })
  if (!url.ok) {
    volver('error', `No se pudo iniciar la conexión: ${url.error}`)
  }

  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity)
      values (${session.tenantId}, ${session.userId}, 'whatsapp.zernio_iniciado',
              'channel_account')
    `),
  )

  revalidatePath('/configuracion/whatsapp')
  // A Facebook. Vuelve por /api/zernio/callback.
  redirect(url.data)
}
