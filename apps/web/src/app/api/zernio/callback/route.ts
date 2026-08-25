/**
 * La vuelta de Facebook, después del Embedded Signup de Zernio.
 *
 * Zernio devuelve a la persona acá con `connected`, `profileId`, `accountId`
 * y `username` en la query. Lo único que hacemos es dejar asentada la cuenta
 * que quedó conectada.
 *
 * Esta ruta es un GET del NAVEGADOR: cualquiera puede escribirla a mano con
 * los parámetros que se le ocurran. Por eso no alcanza con leer la query —
 * hay dos chequeos que sí importan:
 *
 *   1. Sesión de administrador. Sin eso, un visitante anónimo daría de alta
 *      cuentas en un consultorio ajeno.
 *   2. El `profileId` que vuelve tiene que ser EL de este consultorio, el que
 *      guardamos al iniciar. Sin eso, un admin podría escribir a mano el
 *      accountId de otro cliente y quedarse con sus conversaciones.
 */
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/auth'
import { withTenant, withSystem } from '@/lib/db/client'
import { cuentasConectadas } from '@/lib/zernio'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function volver(req: Request, tipo: 'ok' | 'error', msg: string) {
  const url = new URL('/configuracion/whatsapp', req.url)
  url.searchParams.set('r', tipo)
  url.searchParams.set('m', msg.slice(0, 200))
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const session = await requireAdmin()
  const q = new URL(req.url).searchParams

  const error = q.get('error') ?? q.get('error_description')
  if (error) {
    return volver(req, 'error', `Meta rechazó la conexión: ${error}`)
  }

  const accountId = q.get('accountId')?.trim()
  const profileId = q.get('profileId')?.trim()
  if (!accountId) {
    return volver(
      req,
      'error',
      'La conexión se canceló o Meta no devolvió ninguna cuenta.',
    )
  }

  // Chequeo 2: el profile tiene que ser el nuestro.
  const propio = await withSystem(async (tx) => {
    const res = await tx.execute(
      sql`select zernio_profile_id from tenants where id = ${session.tenantId}`,
    )
    return (res.rows[0] as { zernio_profile_id: string | null } | undefined)
      ?.zernio_profile_id
  })
  if (!propio || (profileId && profileId !== propio)) {
    return volver(
      req,
      'error',
      'Esa conexión no corresponde a esta cuenta. Volvé a empezar desde el botón.',
    )
  }

  // El número y el nombre no vienen en la query: se leen de la API.
  const cuentas = await cuentasConectadas(propio)
  const cuenta = cuentas.ok
    ? cuentas.data.find((c) => (c._id ?? c.id) === accountId)
    : undefined
  const telefono = (cuenta?.username ?? '').replace(/\D/g, '') || null
  const etiqueta = cuenta?.displayName?.trim() || 'WhatsApp'

  // Un número no puede estar en dos consultorios. El índice único
  // (provider, external_id) lo impide, pero un error de Postgres en la
  // pantalla no le dice nada a nadie.
  const ocupado = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select tenant_id from channel_accounts
       where provider = 'zernio' and external_id = ${accountId}
    `)
    const fila = res.rows[0] as { tenant_id: string } | undefined
    return fila && fila.tenant_id !== session.tenantId
  })
  if (ocupado) {
    return volver(req, 'error', 'Ese número ya está conectado en otra cuenta.')
  }

  await withTenant(session, (tx) =>
    tx.execute(sql`
      insert into channel_accounts (
        tenant_id, channel, provider, external_id, label, phone,
        status, connected_at, last_error, qr, qr_expires_at
      ) values (
        ${session.tenantId}, 'whatsapp', 'zernio', ${accountId}, ${etiqueta},
        ${telefono}, 'connected', now(), null, null, null
      )
      on conflict (provider, external_id) where external_id is not null
      do update set
        status = 'connected', connected_at = now(), last_error = null,
        phone = coalesce(excluded.phone, channel_accounts.phone),
        label = excluded.label
    `),
  )

  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity)
      values (${session.tenantId}, ${session.userId}, 'whatsapp.zernio_conectado',
              'channel_account')
    `),
  )

  return volver(req, 'ok', 'WhatsApp conectado.')
}
