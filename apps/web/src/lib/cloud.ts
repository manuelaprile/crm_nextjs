/**
 * Canal oficial de WhatsApp: la Cloud API de Meta.
 *
 * El segundo proveedor del mismo canal. Vive entero en este archivo y en la
 * ruta `/api/ingest/cloud`: el camino de Baileys —el worker, el QR, la cola
 * con jitter— no se toca en absoluto. Un tenant usa uno o el otro, y la
 * columna `provider` decide cuál.
 *
 * Qué cambia respecto de Baileys:
 *
 *   - No hay worker ni sesión que mantener. Meta empuja lo que entra a un
 *     webhook nuestro, y lo que sale es un POST a la Graph API.
 *   - No hay riesgo de baneo por usar una librería no oficial: es la vía que
 *     Meta bendice. Sí hay reglas de contenido, que son otra cosa.
 *   - Cuesta plata SOLO si el negocio inicia la conversación. Contestarle a
 *     alguien que escribió, dentro de las 24 horas, es gratis y sin tope.
 *
 * Qué NO cambia, y es lo importante: la identidad del contacto sigue siendo
 * `<numero>@s.whatsapp.net`, igual que en Baileys. Así, el día que un cliente
 * migre de un proveedor al otro, las conversaciones y los contactos que ya
 * tiene siguen siendo los mismos. Ver la regla 3 de CLAUDE.md.
 */
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import { isSealed, open, seal } from './crypto'
import type { InboundPayload, WaMessage } from './ingest'

const GRAPH = process.env.META_GRAPH_VERSION ?? 'v25.0'
const APP_SECRET = process.env.META_APP_SECRET ?? ''
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? ''

// ---------------------------------------------------------------------
// Webhook: verificación y firma
// ---------------------------------------------------------------------

/**
 * El apretón de manos que Meta hace UNA vez, al dar de alta la URL.
 *
 * Manda un GET con un token que tenemos que reconocer y un desafío que hay
 * que devolver tal cual. Sin token configurado se rechaza todo: fail-closed,
 * como el resto de los secretos del sistema.
 */
export function verificarAlta(params: URLSearchParams): string | null {
  const modo = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const desafio = params.get('hub.challenge')
  if (!VERIFY_TOKEN || modo !== 'subscribe' || !desafio) return null
  if (!token || !igual(token, VERIFY_TOKEN)) return null
  return desafio
}

/**
 * Comprueba que el cuerpo lo firmó Meta y no cualquiera que sepa la URL.
 *
 * La URL del webhook es pública por definición. Sin esta verificación,
 * cualquiera puede inventar mensajes entrantes: hacerse pasar por un paciente,
 * hacer que la IA conteste, o llenar la base. Es la única defensa que hay.
 */
export function firmaValida(crudo: string, cabecera: string | null): boolean {
  if (!APP_SECRET || !cabecera?.startsWith('sha256=')) return false
  const esperado = createHmac('sha256', APP_SECRET).update(crudo).digest('hex')
  return igual(cabecera.slice(7), esperado)
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  // La comparación tiene que ser de tiempo constante, pero `timingSafeEqual`
  // explota si los largos difieren: eso se chequea antes, y el largo no es
  // un secreto.
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

// ---------------------------------------------------------------------
// Traducción: webhook de Meta -> lo que ya sabe procesar la ingesta
// ---------------------------------------------------------------------

/** La forma del webhook de Meta, recortada a lo que usamos. */
type WebhookMeta = {
  entry?: {
    changes?: {
      field?: string
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string }
        contacts?: { wa_id?: string; profile?: { name?: string } }[]
        messages?: {
          id?: string
          from?: string
          timestamp?: string
          type?: string
          text?: { body?: string }
          image?: { caption?: string }
          video?: { caption?: string }
          document?: { caption?: string; filename?: string }
          button?: { text?: string }
          interactive?: {
            button_reply?: { title?: string }
            list_reply?: { title?: string }
          }
        }[]
      }
    }[]
  }[]
}

export type EntranteCloud = {
  /** El phone_number_id de Meta: por acá se rutea a la cuenta. */
  numeroId: string
  mensaje: WaMessage
}

/**
 * Convierte lo que manda Meta a la misma forma que manda el worker.
 *
 * Traducir acá y reusar `procesarEntrante` es deliberado: la resolución del
 * contacto, la idempotencia y el disparo del agente quedan en UN solo lugar
 * para los dos proveedores. Si cada canal tuviera su propia copia, tarde o
 * temprano uno de los dos arreglos se aplicaría solo en una.
 */
export function traducirEntrante(cuerpo: unknown): EntranteCloud[] {
  const webhook = cuerpo as WebhookMeta
  const salida: EntranteCloud[] = []

  for (const entry of webhook.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const valor = change.value
      const numeroId = valor?.metadata?.phone_number_id
      if (!numeroId) continue

      // Los nombres vienen en un array aparte, indexados por wa_id.
      const nombres = new Map<string, string>()
      for (const c of valor?.contacts ?? []) {
        if (c.wa_id && c.profile?.name) nombres.set(c.wa_id, c.profile.name)
      }

      for (const m of valor?.messages ?? []) {
        if (!m.id || !m.from) continue
        salida.push({
          numeroId,
          mensaje: {
            key: {
              id: m.id,
              // Mismo formato de JID que Baileys, a propósito: es lo que hace
              // que un contacto sobreviva a una migración de proveedor.
              remoteJid: `${m.from}@s.whatsapp.net`,
              fromMe: false,
              phoneJid: `${m.from}@s.whatsapp.net`,
              lidJid: null,
            },
            pushName: nombres.get(m.from) ?? null,
            messageTimestamp: m.timestamp ? Number(m.timestamp) : null,
            message: contenido(m),
          },
        })
      }
    }
  }

  return salida
}

/**
 * Arma un `message` con la forma de Baileys.
 *
 * `extractText` y `messageType` de la ingesta leen esa forma, así que en vez
 * de duplicarlos con un `if` por proveedor, se le da lo que ya sabe leer.
 */
function contenido(
  m: NonNullable<
    NonNullable<
      NonNullable<NonNullable<WebhookMeta['entry']>[number]['changes']>[number]['value']
    >['messages']
  >[number],
): Record<string, unknown> {
  switch (m.type) {
    case 'text':
      return { conversation: m.text?.body ?? '' }
    case 'image':
      return { imageMessage: { caption: m.image?.caption } }
    case 'video':
      return { videoMessage: { caption: m.video?.caption } }
    case 'audio':
      return { audioMessage: {} }
    case 'document':
      return { documentMessage: { caption: m.document?.caption } }
    case 'location':
      return { locationMessage: {} }
    case 'sticker':
      return { stickerMessage: {} }
    case 'button':
      return { buttonsResponseMessage: { selectedDisplayText: m.button?.text } }
    case 'interactive':
      return {
        listResponseMessage: {
          title: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title,
        },
      }
    default:
      return {}
  }
}

/** Arma el payload que espera `procesarEntrante`. */
export function payloadDe(
  cuenta: { id: string; tenant_id: string },
  entrante: EntranteCloud,
): InboundPayload {
  return {
    // Mismo esquema de id que Baileys, con otro prefijo: el id del mensaje ES
    // el id del evento, y así los dos proveedores no se pisan nunca.
    eventId: `cloud:${entrante.mensaje.key.id}`,
    kind: 'message.inbound',
    tenantId: cuenta.tenant_id,
    accountId: cuenta.id,
    accountJid: null,
    message: entrante.mensaje,
  }
}

// ---------------------------------------------------------------------
// Cuentas y credenciales
// ---------------------------------------------------------------------

export type CuentaCloud = {
  id: string
  tenant_id: string
  external_id: string
}

/** Busca a qué cuenta pertenece un número de Meta. */
export async function cuentaPorNumero(
  numeroId: string,
): Promise<CuentaCloud | undefined> {
  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select ca.id, ca.tenant_id, ca.external_id
        from channel_accounts ca
        join tenants t on t.id = ca.tenant_id
       where ca.provider = 'cloud_api'
         and ca.external_id = ${numeroId}
         and t.status in ('trial','active')
    `)
    return res.rows[0] as CuentaCloud | undefined
  })
}

/**
 * El token de acceso de una cuenta, descifrado.
 *
 * Va por `withSystem` porque el panel no tiene permiso de lectura sobre esa
 * columna — ver los grants de la migración 0015.
 */
export async function tokenDe(accountId: string): Promise<string | null> {
  const guardado = await withSystem(async (tx) => {
    const res = await tx.execute(
      sql`select token_enc from channel_accounts where id = ${accountId}`,
    )
    return res.rows[0]?.token_enc ?? null
  })
  if (!isSealed(guardado)) return null
  try {
    return open(guardado)
  } catch {
    // Cambió la clave de cifrado, o la fila está corrupta. Devolver null hace
    // que el envío falle con un mensaje claro en vez de mandar basura.
    console.error('[cloud] no se pudo descifrar el token de', accountId)
    return null
  }
}

/** Guarda (o reemplaza) las credenciales de un número oficial. */
export async function guardarCredenciales(entrada: {
  accountId: string
  phoneNumberId: string
  wabaId: string | null
  token: string
  telefono: string | null
}): Promise<void> {
  await withSystem((tx) =>
    tx.execute(sql`
      update channel_accounts
         set provider = 'cloud_api',
             external_id = ${entrada.phoneNumberId},
             waba_id = ${entrada.wabaId},
             token_enc = ${JSON.stringify(seal(entrada.token))}::jsonb,
             token_hint = ${pista(entrada.token)},
             phone = ${entrada.telefono},
             status = 'connected',
             connected_at = now(),
             last_error = null,
             qr = null,
             qr_expires_at = null
       where id = ${entrada.accountId}
    `),
  )
}

/** "…4f2a": lo justo para reconocer cuál está cargado, sin poder usarlo. */
function pista(token: string): string {
  return `…${token.slice(-4)}`
}

// ---------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------

export type ResultadoEnvio =
  | { ok: true; externalId: string | null }
  | { ok: false; error: string }

/**
 * Manda un mensaje de texto por la Graph API.
 *
 * Sin cola ni jitter, al revés que Baileys: acá no hay nada que disimular, y
 * Meta tiene su propio control de caudal que devuelve un error claro si se
 * pasa. Meter una espera artificial solo haría más lenta la respuesta.
 */
export async function enviarPorCloud(entrada: {
  accountId: string
  numeroId: string
  para: string
  texto: string
}): Promise<ResultadoEnvio> {
  const token = await tokenDe(entrada.accountId)
  if (!token) {
    return { ok: false, error: 'Falta el token de WhatsApp o no se pudo leer' }
  }

  // El destinatario se guarda como JID por compatibilidad con Baileys; Meta
  // quiere el número pelado.
  const destino = entrada.para.split('@')[0]?.split(':')[0] ?? entrada.para

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH}/${entrada.numeroId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destino,
          type: 'text',
          text: { preview_url: false, body: entrada.texto },
        }),
      },
    )

    const cuerpo = (await res.json().catch(() => null)) as {
      messages?: { id?: string }[]
      error?: { message?: string; code?: number; error_subcode?: number }
    } | null

    if (!res.ok) {
      // El mensaje de Meta es útil y no trae secretos nuestros, así que se
      // muestra tal cual en la bandeja: "el número no tiene WhatsApp",
      // "la ventana de 24 horas se cerró", etc.
      const detalle = cuerpo?.error?.message ?? `HTTP ${res.status}`
      console.error('[cloud] falló el envío', cuerpo?.error ?? res.status)
      return { ok: false, error: detalle }
    }

    return { ok: true, externalId: cuerpo?.messages?.[0]?.id ?? null }
  } catch (err) {
    console.error('[cloud] error de red al enviar', err)
    return { ok: false, error: 'No se pudo contactar a WhatsApp' }
  }
}
