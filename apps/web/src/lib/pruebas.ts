'use server'

/**
 * Laboratorio de pruebas: simula mensajes entrantes de WhatsApp.
 *
 * ======================================================================
 * POR QUÉ EXISTE
 * ======================================================================
 * Probar el sistema de verdad exige un celular con un número vinculado por
 * QR. Eso es lento, arriesgado (cada vinculación suma exposición ante Meta) y
 * no se puede repetir cien veces mientras desarrollás.
 *
 * Este módulo inyecta un mensaje entrante como si lo hubiera mandado el
 * worker, y lo hace pasando por `procesarEntrante()`, que es EXACTAMENTE la
 * misma función que usa el WhatsApp real. Se prueba el sistema, no una copia.
 *
 * Lo único que no se ejercita es el transporte (Baileys). Todo lo demás sí:
 * idempotencia, resolución de contacto, creación de conversación, disparo del
 * agente, herramientas, cambio de etapa, notas y derivación.
 *
 * ======================================================================
 * SEGURIDAD
 * ======================================================================
 * Todo este módulo está detrás de `TEST_MODE=1`. Sin esa variable, cada
 * función corta antes de tocar nada. En el servidor NO se define, así que en
 * producción esto no existe: inyectar mensajes falsos en la bandeja de un
 * consultorio real sería un desastre.
 */
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant } from './db/client'
import { procesarEntrante } from './ingest'

export async function modoPruebaActivo(): Promise<boolean> {
  return process.env.TEST_MODE === '1'
}

function exigirModoPrueba(): void {
  if (process.env.TEST_MODE !== '1') {
    throw new Error('El modo prueba está desactivado (falta TEST_MODE=1)')
  }
}

export type Resultado = { ok: boolean; mensaje: string; conversationId?: string }

/**
 * Crea (o reusa) un número de WhatsApp simulado para este consultorio.
 * Queda en estado `connected` con provider `mock`: la bandeja lo trata como
 * un número real, pero lo que sale no viaja a ningún lado.
 */
export async function crearNumeroSimulado(): Promise<Resultado> {
  exigirModoPrueba()
  const session = await requireAdmin()

  const id = await withTenant(session, async (tx) => {
    const existe = await tx.execute(sql`
      select id from channel_accounts where provider = 'mock' limit 1
    `)
    if (existe.rows.length) return String(existe.rows[0]!.id)

    const res = await tx.execute(sql`
      insert into channel_accounts
        (tenant_id, channel, provider, label, status, phone, external_id, connected_at)
      values (${session.tenantId}, 'whatsapp', 'mock', 'Número de prueba',
              'connected', '5490000000000',
              ${'mock:' + session.tenantId}, now())
      returning id
    `)
    return String(res.rows[0]!.id)
  })

  revalidatePath('/pruebas')
  revalidatePath('/configuracion/whatsapp')
  return { ok: true, mensaje: `Número de prueba listo (${id.slice(0, 8)}…)` }
}

/**
 * Inyecta un mensaje entrante. Es lo que haría el worker al recibir un
 * WhatsApp real.
 */
export async function simularMensaje(
  _prev: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  exigirModoPrueba()
  const session = await requireAdmin()

  const telefono = String(formData.get('telefono') ?? '')
    .replace(/[^0-9]/g, '')
    .slice(0, 15)
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 80)
  const texto = String(formData.get('texto') ?? '').trim().slice(0, 4000)

  if (!telefono) return { ok: false, mensaje: 'Falta el teléfono.' }
  if (!texto) return { ok: false, mensaje: 'Falta el mensaje.' }

  const cuenta = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select id from channel_accounts where provider = 'mock' limit 1
    `)
    return res.rows[0]?.id ? String(res.rows[0].id) : null
  })

  if (!cuenta) {
    return {
      ok: false,
      mensaje: 'Primero creá el número de prueba con el botón de arriba.',
    }
  }

  // El id del evento tiene que ser único en cada envío: si se repitiera, la
  // idempotencia lo descartaría como reintento — que es justamente lo que
  // queremos que haga con los reintentos de verdad.
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`

  const res = await procesarEntrante({
    eventId: `sim:${marca}`,
    kind: 'message.inbound',
    tenantId: session.tenantId,
    accountId: cuenta,
    accountJid: 'mock:cuenta',
    message: {
      key: {
        id: `SIM${marca}`,
        remoteJid: `${telefono}@s.whatsapp.net`,
        fromMe: false,
      },
      pushName: nombre || null,
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: texto },
    },
  })

  revalidatePath('/pruebas')
  revalidatePath('/bandeja')

  if (res.estado === 'duplicado') {
    return { ok: false, mensaje: 'El sistema lo tomó como repetido.' }
  }
  if (res.estado === 'ignorado') {
    return { ok: false, mensaje: 'El mensaje se ignoró (revisá la cuenta).' }
  }
  return {
    ok: true,
    mensaje: 'Mensaje recibido. Si el asistente está activo, responde en unos segundos.',
    conversationId: res.conversationId,
  }
}

/** Prueba que la idempotencia funciona: manda dos veces el MISMO evento. */
export async function probarIdempotencia(): Promise<Resultado> {
  exigirModoPrueba()
  const session = await requireAdmin()

  const cuenta = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select id from channel_accounts where provider = 'mock' limit 1
    `)
    return res.rows[0]?.id ? String(res.rows[0].id) : null
  })
  if (!cuenta) return { ok: false, mensaje: 'Falta el número de prueba.' }

  const marca = `${Date.now()}`
  const payload = {
    eventId: `sim-dup:${marca}`,
    kind: 'message.inbound',
    tenantId: session.tenantId,
    accountId: cuenta,
    accountJid: 'mock:cuenta',
    message: {
      key: {
        id: `DUP${marca}`,
        remoteJid: `5493510000001@s.whatsapp.net`,
        fromMe: false,
      },
      pushName: 'Prueba de repetido',
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'Mensaje repetido de prueba' },
    },
  }

  const primero = await procesarEntrante(payload)
  const segundo = await procesarEntrante(payload)

  revalidatePath('/pruebas')
  revalidatePath('/bandeja')

  const bien = primero.estado === 'ok' && segundo.estado === 'duplicado'
  return {
    ok: bien,
    mensaje: bien
      ? 'Correcto: el primero se procesó y el segundo se descartó como repetido.'
      : `Algo anda mal: primero=${primero.estado}, segundo=${segundo.estado}`,
  }
}

/** Borra todo lo generado en las pruebas. No toca datos reales. */
export async function limpiarPruebas(): Promise<Resultado> {
  exigirModoPrueba()
  const session = await requireAdmin()

  const borrados = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      with cuentas as (
        select id from channel_accounts where provider = 'mock'
      ), convs as (
        delete from conversations
         where account_id in (select id from cuentas)
        returning contact_id
      )
      delete from contacts
       where id in (select contact_id from convs where contact_id is not null)
      returning id
    `)
    return res.rows.length
  })

  revalidatePath('/pruebas')
  revalidatePath('/bandeja')
  revalidatePath('/contactos')
  return {
    ok: true,
    mensaje: `Listo: se borraron ${borrados} contacto(s) de prueba y sus conversaciones.`,
  }
}

export type EstadoPruebas = {
  numeroListo: boolean
  conversaciones: number
  mensajes: number
  iaActiva: boolean
  proveedorIA: string
  claveCargada: boolean
}

export async function estadoPruebas(): Promise<EstadoPruebas> {
  const session = await requireAdmin()
  return withTenant(session, async (tx) => {
    const cuenta = await tx.execute(sql`
      select id from channel_accounts where provider = 'mock' limit 1
    `)
    const conv = await tx.execute(sql`
      select count(*)::int as n from conversations c
        join channel_accounts ca on ca.id = c.account_id
       where ca.provider = 'mock'
    `)
    const msg = await tx.execute(sql`
      select count(*)::int as n from messages m
        join conversations c on c.id = m.conversation_id
        join channel_accounts ca on ca.id = c.account_id
       where ca.provider = 'mock'
    `)
    const ia = await tx.execute(sql`
      select enabled, provider, api_key_hint from agent_configs
       where channel = 'whatsapp'
    `)
    const row = ia.rows[0] as Record<string, unknown> | undefined
    return {
      numeroListo: cuenta.rows.length > 0,
      conversaciones: Number(conv.rows[0]?.n ?? 0),
      mensajes: Number(msg.rows[0]?.n ?? 0),
      iaActiva: Boolean(row?.enabled),
      proveedorIA: String(row?.provider ?? '—'),
      claveCargada: Boolean(row?.api_key_hint),
    }
  })
}
