'use server'

/**
 * Alta manual de un número por el canal oficial.
 *
 * Es el camino que funciona HOY, sin depender de que Meta apruebe nada: el
 * cliente crea su cuenta desde WhatsApp Manager y nos pasa dos datos. Cuando
 * llegue la aprobación de Tech Provider, el Embedded Signup va a llenar
 * exactamente los mismos campos desde una ventana de Facebook, y todo lo que
 * hay debajo —el webhook, el envío, la bandeja— sigue igual.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant, withSystem } from './db/client'
import { guardarCredenciales } from './cloud'

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/configuracion/whatsapp?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

export async function conectarCloudApi(formData: FormData): Promise<void> {
  const session = await requireAdmin()

  const phoneNumberId = String(formData.get('phoneNumberId') ?? '').trim()
  const wabaId = String(formData.get('wabaId') ?? '').trim()
  const token = String(formData.get('token') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()
  const etiqueta = String(formData.get('label') ?? '').trim() || 'Oficial'

  if (!/^\d{5,}$/.test(phoneNumberId)) {
    volver('error', 'El identificador del número son solo dígitos. Copialo de WhatsApp Manager.')
  }
  if (token.length < 20) {
    volver('error', 'Ese token parece incompleto.')
  }

  // El número no puede estar ya cargado en otra cuenta: el índice único
  // (provider, external_id) lo impide, pero un error de Postgres en la
  // pantalla no le dice nada a nadie.
  const ocupado = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select tenant_id from channel_accounts
       where provider = 'cloud_api' and external_id = ${phoneNumberId}
    `)
    const fila = res.rows[0] as { tenant_id: string } | undefined
    return fila && fila.tenant_id !== session.tenantId
  })
  if (ocupado) {
    volver('error', 'Ese número ya está conectado en otra cuenta.')
  }

  // Se reusa la cuenta oficial que ya exista, y si no hay se crea una. El
  // límite del plan se respeta igual que en el alta por QR.
  const accountId = await withTenant(session, async (tx) => {
    const existente = await tx.execute(sql`
      select id from channel_accounts
       where channel = 'whatsapp' and provider = 'cloud_api'
       order by created_at limit 1
    `)
    const fila = existente.rows[0] as { id: string } | undefined
    if (fila) return String(fila.id)

    const limite = await tx.execute(
      sql`select max_wa_accounts from tenants where id = ${session.tenantId}`,
    )
    const cuantas = await tx.execute(
      sql`select count(*)::int as n from channel_accounts where channel = 'whatsapp'`,
    )
    const max = Number(limite.rows[0]?.max_wa_accounts ?? 1)
    if (Number(cuantas.rows[0]?.n ?? 0) >= max) {
      return null
    }

    const nueva = await tx.execute(sql`
      insert into channel_accounts (tenant_id, label, provider)
      values (${session.tenantId}, ${etiqueta}, 'cloud_api')
      returning id
    `)
    return String(nueva.rows[0]!.id)
  })

  if (!accountId) {
    volver('error', 'Alcanzaste el límite de números de tu plan.')
  }

  await guardarCredenciales({
    accountId,
    phoneNumberId,
    wabaId: wabaId || null,
    token,
    telefono: telefono.replace(/\D/g, '') || null,
  })

  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId}, 'whatsapp.cloud_conectado',
              'channel_account', ${accountId})
    `),
  )

  revalidatePath('/configuracion/whatsapp')
  volver('ok', 'Número oficial conectado.')
}
