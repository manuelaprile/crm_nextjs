/**
 * Zernio: el tercer proveedor del canal de WhatsApp.
 *
 * Los otros dos son `baileys` (QR, no oficial) y `cloud_api` (oficial, alta
 * a mano). Zernio es también el canal oficial de Meta, pero a través de un
 * socio ya aprobado como Tech Provider. Eso nos da dos cosas que solos no
 * tenemos:
 *
 *   1. El alta es un botón. Embedded Signup con la aprobación de ellos, sin
 *      esperar semanas de trámite nuestro.
 *   2. COEXISTENCE: el número sigue andando en la aplicación de WhatsApp del
 *      celular mientras los mensajes entran por la API. Con `cloud_api` a
 *      secas, registrar un número lo saca de la app.
 *
 * A cambio, es una dependencia en el camino crítico: todos los mensajes de
 * todos los clientes pasan por ellos, con NUESTRA clave. Por eso el cliente
 * de abajo no lanza excepciones —un proveedor caído no puede voltear un
 * request del panel— y todo lo que entra se verifica por firma.
 *
 * Tipado contra el OpenAPI real (https://docs.zernio.com/api/openapi,
 * v1.0.4). Los nombres de los campos NO se adivinan: un nombre mal adivinado
 * no rompe el build, descarta cada mensaje que entra.
 */
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import type { InboundPayload, WaMessage } from './ingest'

const BASE = process.env.ZERNIO_BASE_URL ?? 'https://zernio.com/api'
const API_KEY = process.env.ZERNIO_API_KEY ?? ''
const WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET ?? ''

/** Si el proveedor está configurado. Sin clave, todo el módulo queda inerte. */
export function zernioActivo(): boolean {
  return Boolean(API_KEY)
}

// ---------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------

export type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number }

/**
 * Una llamada a la API. NUNCA lanza: devuelve el error como valor.
 *
 * Es la regla del proveedor único — si Zernio se cae, el panel tiene que
 * seguir mostrando la bandeja con lo que ya está en la base, no romperse
 * entero.
 */
async function llamar<T>(
  ruta: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<Resultado<T>> {
  if (!API_KEY) {
    return { ok: false, error: 'Zernio no está configurado (falta ZERNIO_API_KEY)' }
  }
  const { idempotencyKey, ...resto } = init ?? {}
  try {
    const res = await fetch(`${BASE}${ruta}`, {
      ...resto,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        ...(resto.headers ?? {}),
      },
      cache: 'no-store',
    })
    const texto = await res.text()
    let cuerpo: unknown = null
    try {
      cuerpo = texto ? JSON.parse(texto) : null
    } catch {
      /* algunas respuestas de error vienen en texto pelado */
    }
    if (!res.ok) {
      const detalle =
        (cuerpo as { error?: string; message?: string } | null)?.error ??
        (cuerpo as { message?: string } | null)?.message ??
        texto.slice(0, 200)
      return { ok: false, error: detalle || `HTTP ${res.status}`, status: res.status }
    }
    return { ok: true, data: cuerpo as T }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ---------------------------------------------------------------------
// Profiles: un espacio de trabajo de Zernio por consultorio
// ---------------------------------------------------------------------

type Profile = { _id: string; name: string }

/**
 * El profile del consultorio, creándolo si es la primera vez.
 *
 * El aislamiento entre clientes lo da esto: cada consultorio tiene su propio
 * espacio en Zernio y sus cuentas no se ven entre sí. Meter todos los números
 * en el profile por defecto haría que un error de ruteo mezclara pacientes de
 * dos consultorios distintos, que es el peor accidente posible acá.
 */
export async function profileDeTenant(
  tenantId: string,
  nombre: string,
): Promise<Resultado<string>> {
  const fila = await withSystem(async (tx) => {
    const res = await tx.execute(
      sql`select zernio_profile_id from tenants where id = ${tenantId}`,
    )
    return res.rows[0] as { zernio_profile_id: string | null } | undefined
  })
  if (fila?.zernio_profile_id) return { ok: true, data: fila.zernio_profile_id }

  const creado = await llamar<{ profile?: Profile } & Partial<Profile>>('/v1/profiles', {
    method: 'POST',
    // El nombre lleva el id adelante: en el panel de Zernio los consultorios
    // se pueden llamar igual, y ahí no hay forma de distinguirlos.
    body: JSON.stringify({ name: `${nombre} (${tenantId.slice(0, 8)})` }),
  })
  if (!creado.ok) return creado

  const id = creado.data?.profile?._id ?? creado.data?._id
  if (!id) return { ok: false, error: 'Zernio no devolvió el id del profile' }

  await withSystem((tx) =>
    tx.execute(sql`update tenants set zernio_profile_id = ${id} where id = ${tenantId}`),
  )
  return { ok: true, data: id }
}

/**
 * La URL de Facebook a la que hay que mandar a la persona.
 *
 * `onboarding` decide qué pantalla muestra Meta. Sin el parámetro, Zernio usa
 * coexistence por defecto, que es lo que queremos: el número sigue vivo en la
 * aplicación del celular. Se deja explícito igual, porque un default ajeno
 * puede cambiar y acá cambiaría en silencio algo que le importa al cliente.
 */
export async function urlDeConexion(params: {
  profileId: string
  redirectUrl: string
  coexistence?: boolean
}): Promise<Resultado<string>> {
  const q = new URLSearchParams({
    profileId: params.profileId,
    redirect_url: params.redirectUrl,
    onboarding: params.coexistence === false ? 'api' : 'business_app',
  })
  const res = await llamar<{ authUrl?: string }>(`/v1/connect/whatsapp?${q}`)
  if (!res.ok) return res
  if (!res.data?.authUrl) return { ok: false, error: 'Zernio no devolvió authUrl' }
  return { ok: true, data: res.data.authUrl }
}

type CuentaZernio = {
  _id?: string
  id?: string
  platform?: string
  username?: string
  displayName?: string
  profileId?: string
}

/** Las cuentas conectadas, para poder leer el teléfono y el nombre tras el alta. */
export async function cuentasConectadas(
  profileId: string,
): Promise<Resultado<CuentaZernio[]>> {
  const q = new URLSearchParams({ profileId, platform: 'whatsapp' })
  const res = await llamar<{ accounts?: CuentaZernio[] }>(`/v1/accounts?${q}`)
  if (!res.ok) return res
  return { ok: true, data: res.data?.accounts ?? [] }
}

// ---------------------------------------------------------------------
// Webhook: firma y traducción
// ---------------------------------------------------------------------

/**
 * Comprueba que el cuerpo lo firmó Zernio.
 *
 * La URL del webhook es pública. Sin esto, cualquiera que la descubra puede
 * inventar pacientes y hacer que la IA les conteste. Igual que en el canal
 * oficial: fail-closed si no hay secreto configurado, y comparación de tiempo
 * constante sobre el cuerpo CRUDO.
 */
export function firmaValida(crudo: string, cabecera: string | null): boolean {
  if (!WEBHOOK_SECRET || !cabecera) return false
  const esperado = createHmac('sha256', WEBHOOK_SECRET).update(crudo).digest('hex')
  // Zernio manda el hex pelado; se tolera el prefijo por si lo agregan.
  const recibido = cabecera.startsWith('sha256=') ? cabecera.slice(7) : cabecera
  return igual(recibido, esperado)
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

/** La forma del webhook, recortada a lo que usamos. Ver WebhookPayloadMessage. */
type WebhookZernio = {
  id?: string
  event?: string
  message?: {
    id?: string
    conversationId?: string
    platform?: string
    platformMessageId?: string
    direction?: string
    text?: string | null
    sentAt?: string
    attachments?: { type?: string; url?: string }[]
    sender?: {
      id?: string
      name?: string
      phoneNumber?: string | null
      businessScopedUserId?: string
      whatsappUsername?: string
    }
  }
  conversation?: {
    id?: string
    platformConversationId?: string
    participantId?: string
    participantName?: string
  }
  account?: { id?: string; accountId?: string; platform?: string }
}

export type EntranteZernio = {
  eventoId: string
  cuentaZernio: string
  conversacionZernio: string
  identidad: string
  telefono: string | null
  nombre: string | null
  mensajeId: string
  texto: string | null
  tipo: string
  enviadoEn: string | null
}

/**
 * Quién es el del otro lado.
 *
 * WhatsApp está sacando el teléfono del medio: desde abril de 2026 alguien
 * con nombre de usuario puede escribirle a un negocio SIN exponer su número,
 * y `phoneNumber` llega vacío. El ancla recomendada pasa a ser el
 * `businessScopedUserId`.
 *
 * Es el mismo problema del LID que ya tuvimos con Baileys, otra vez: la
 * identidad NO es el teléfono. Se ancla en el BSUID cuando está, y se cae al
 * número solo si no hay otra cosa. El teléfono se guarda aparte, para
 * mostrar y para llamar, y puede ser null — un contacto sin teléfono es mejor
 * que uno con un teléfono inventado.
 */
function identidadDeZernio(p: WebhookZernio): {
  identidad: string | null
  telefono: string | null
} {
  const s = p.message?.sender
  const bsuid = s?.businessScopedUserId?.trim()

  // `sender.id` es "el teléfono cuando está disponible, si no el BSUID". O
  // sea que NO se puede tratar como número sin mirarlo: limpiarle los signos
  // a `bsuid_abc123` deja "123", un teléfono inventado que después alguien
  // intenta llamar. Solo cuenta como teléfono si es todo dígitos y tiene
  // largo de número real.
  const telefono = soloTelefono(s?.phoneNumber) ?? soloTelefono(s?.id)

  // El sufijo mantiene el formato de JID que usa el resto del sistema, así
  // que un contacto que venía por Baileys o por Cloud API se reconoce igual
  // y conserva su historial.
  if (telefono) return { identidad: `${telefono}@s.whatsapp.net`, telefono }
  if (bsuid) return { identidad: `${bsuid}@lid`, telefono: null }
  const pid = p.conversation?.participantId?.trim()
  return { identidad: pid ? `${pid}@lid` : null, telefono: null }
}

/**
 * Un teléfono, o nada.
 *
 * Acepta el formato E.164 con o sin `+`. Rechaza cualquier cosa con letras:
 * un identificador opaco al que se le sacan los signos parece un teléfono y
 * no lo es. El piso de 8 dígitos descarta restos sueltos.
 */
function soloTelefono(v: string | null | undefined): string | null {
  if (!v) return null
  const limpio = v.trim().replace(/^\+/, '')
  if (!/^\d{8,}$/.test(limpio)) return null
  return limpio
}

/** Traduce un webhook al puñado de campos que necesitamos. */
export function traducirEntrante(cuerpo: unknown): EntranteZernio | null {
  const p = cuerpo as WebhookZernio
  if (p?.event !== 'message.received') return null
  if (p.message?.platform !== 'whatsapp') return null
  // Los ecos de lo que mandamos nosotros llegan como `outgoing`. Procesarlos
  // haría que el agente se conteste a sí mismo.
  if (p.message?.direction !== 'incoming') return null

  const cuenta = p.account?.accountId ?? p.account?.id
  const conversacion = p.message?.conversationId ?? p.conversation?.id
  const mensajeId = p.message?.platformMessageId ?? p.message?.id
  const { identidad, telefono } = identidadDeZernio(p)
  if (!p.id || !cuenta || !conversacion || !mensajeId || !identidad) return null

  return {
    eventoId: `zernio:${p.id}`,
    cuentaZernio: cuenta,
    conversacionZernio: conversacion,
    identidad,
    telefono,
    nombre:
      p.message?.sender?.name?.trim() ||
      p.conversation?.participantName?.trim() ||
      null,
    mensajeId,
    texto: p.message?.text ?? null,
    tipo: tipoDe(p),
    enviadoEn: p.message?.sentAt ?? null,
  }
}

function tipoDe(p: WebhookZernio): string {
  const a = p.message?.attachments?.[0]?.type
  if (!a) return 'text'
  if (a === 'image' || a === 'video' || a === 'audio' || a === 'sticker') return a
  return 'document'
}

/**
 * Arma el payload con la forma que ya sabe procesar `procesarEntrante`.
 *
 * Se reusa la ingesta en vez de duplicarla: la resolución del contacto, la
 * idempotencia y el disparo del agente quedan en un solo lugar para los tres
 * proveedores.
 */
export function payloadDe(
  cuenta: { id: string; tenantId: string; externalId: string | null },
  e: EntranteZernio,
): InboundPayload {
  const mensaje: WaMessage = {
    key: {
      id: e.mensajeId,
      remoteJid: e.identidad,
      fromMe: false,
      phoneJid: e.telefono ? `${e.telefono}@s.whatsapp.net` : null,
      lidJid: e.identidad.endsWith('@lid') ? e.identidad : null,
    },
    pushName: e.nombre,
    messageTimestamp: e.enviadoEn
      ? Math.floor(new Date(e.enviadoEn).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
    message: e.texto ? { conversation: e.texto } : contenidoSinTexto(e.tipo),
  }
  return {
    eventId: e.eventoId,
    kind: 'message',
    tenantId: cuenta.tenantId,
    accountId: cuenta.id,
    accountJid: cuenta.externalId,
    message: mensaje,
    // El id de conversación de Zernio es la dirección de respuesta: sin él
    // se puede recibir pero no contestar. La identidad del hilo sigue siendo
    // el JID (regla 3 del CLAUDE.md), así que esto va aparte.
    metadata: { zernioConversationId: e.conversacionZernio },
  }
}

function contenidoSinTexto(tipo: string): Record<string, unknown> {
  switch (tipo) {
    case 'image':
      return { imageMessage: {} }
    case 'video':
      return { videoMessage: {} }
    case 'audio':
      return { audioMessage: {} }
    case 'sticker':
      return { stickerMessage: {} }
    default:
      return { documentMessage: {} }
  }
}

/** La cuenta del CRM dueña de este id de Zernio. */
export async function cuentaPorId(
  cuentaZernio: string,
): Promise<{ id: string; tenantId: string; externalId: string | null } | null> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select ca.id, ca.tenant_id, ca.external_id
        from channel_accounts ca
        join tenants t on t.id = ca.tenant_id
       where ca.provider = 'zernio' and ca.external_id = ${cuentaZernio}
         and t.status in ('trial','active')
    `)
    const fila = res.rows[0] as
      | { id: string; tenant_id: string; external_id: string | null }
      | undefined
    if (!fila) return null
    return {
      id: String(fila.id),
      tenantId: String(fila.tenant_id),
      externalId: fila.external_id,
    }
  })
}

// ---------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------

/**
 * Manda un mensaje por Zernio.
 *
 * La `Idempotency-Key` es lo que evita el peor accidente del envío: si el
 * request se corta después de que ellos ya aceptaron el mensaje, el reintento
 * repite la respuesta original en vez de mandarlo dos veces. La clave es el
 * id de nuestra fila en `messages`, que es único y estable.
 */
export async function enviarPorZernio(params: {
  conversacionZernio: string
  cuentaZernio: string
  texto: string
  messageId: string
}): Promise<Resultado<string | null>> {
  const res = await llamar<{
    success?: boolean
    data?: { messageId?: string }
  }>(`/v1/inbox/conversations/${encodeURIComponent(params.conversacionZernio)}/messages`, {
    method: 'POST',
    idempotencyKey: params.messageId,
    body: JSON.stringify({
      accountId: params.cuentaZernio,
      message: params.texto,
    }),
  })
  if (!res.ok) return res
  return { ok: true, data: res.data?.data?.messageId ?? null }
}
