/**
 * Una sesión de WhatsApp (= un número conectado = un tenant).
 *
 * Responsabilidades:
 *   - levantar el socket de Baileys con el auth state de Postgres
 *   - publicar el QR al panel y marcar los cambios de estado
 *   - reconectar con backoff, y NO reconectar cuando no corresponde
 *   - empujar lo que entra al webhook interno de la app
 *   - serializar lo que sale con jitter (esto es lo que evita el baneo)
 */
import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import type { Pool } from 'pg'
import pino from 'pino'
import QRCode from 'qrcode'
import { usePostgresAuthState, type PgAuthState } from './auth-store.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

/** Backoff de reconexión: 1s, 2s, 4s… hasta 5 min. */
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 300_000
/** Un QR de WhatsApp vive ~60s; damos margen para el refresh. */
const QR_TTL_MS = 75_000

/**
 * Ventana entre mensajes salientes. La ráfaga es lo que dispara el baneo:
 * un humano no manda 40 mensajes en 10 segundos. El jitter evita además el
 * patrón perfectamente regular, que también es señal de bot.
 */
const SEND_MIN_MS = 3_000
const SEND_MAX_MS = 8_000

export type OutboundJob = {
  to: string
  text: string
  /** id de la fila en `messages`, para poder actualizar estado y external_id */
  messageId: string
}

export type SessionDeps = {
  pool: Pool
  accountId: string
  tenantId: string
  /** A dónde empujamos lo que entra (ruta interna de Next.js). */
  ingestUrl: string
  ingestSecret: string
}

export class WhatsAppSession {
  private sock?: WASocket
  private auth?: PgAuthState
  private attempt = 0
  private stopped = false
  private queue: OutboundJob[] = []
  private draining = false
  private lastSentAt = 0

  constructor(private readonly deps: SessionDeps) {}

  get accountId() {
    return this.deps.accountId
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    try {
      this.sock?.end(undefined)
    } catch {
      /* el socket ya estaba muerto */
    }
    this.sock = undefined
  }

  /** Cierra sesión de verdad: el número queda desvinculado y hay que re-escanear. */
  async logout(): Promise<void> {
    this.stopped = true
    try {
      await this.sock?.logout()
    } catch {
      /* si el socket no responde igual limpiamos abajo */
    }
    await this.auth?.clear()
    await this.setStatus('logged_out', { external_id: null, qr: null })
    this.sock = undefined
  }

  enqueue(job: OutboundJob): void {
    this.queue.push(job)
    void this.drain()
  }

  // -------------------------------------------------------------------
  // Conexión
  // -------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.stopped) return

    this.auth = await usePostgresAuthState(this.deps.pool, this.deps.accountId)
    await this.setStatus('connecting')

    this.sock = makeWASocket({
      auth: {
        creds: this.auth.state.creds,
        // El cache de claves de firma baja muchísimo las lecturas a Postgres
        // en el camino caliente de descifrado.
        keys: makeCacheableSignalKeyStore(this.auth.state.keys, log),
      },
      // El QR lo publicamos nosotros al panel; no lo queremos en los logs.
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      logger: log.child({ accountId: this.deps.accountId }),
      // No marcamos en línea al conectar: si no, WhatsApp deja de mandar
      // notificaciones push al celular del cliente y se queja.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    })

    this.sock.ev.on('creds.update', () => {
      void this.auth?.saveCreds()
    })

    this.sock.ev.on('connection.update', (update) => {
      void this.onConnectionUpdate(update)
    })

    this.sock.ev.on('messages.upsert', (payload) => {
      void this.onMessages(payload)
    })
  }

  private async onConnectionUpdate(
    update: Partial<{
      connection: string
      lastDisconnect: { error?: Error }
      qr: string
    }>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // Lo guardamos ya renderizado a data URL: el panel solo lo pinta.
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
      await this.setStatus('qr_pending', {
        qr: dataUrl,
        qr_expires_at: new Date(Date.now() + QR_TTL_MS),
      })
    }

    if (connection === 'open') {
      this.attempt = 0
      const jid = this.sock?.user?.id ?? null
      await this.setStatus('connected', {
        external_id: jid,
        phone: jid ? phoneFromJid(jid) : null,
        qr: null,
        qr_expires_at: null,
        last_error: null,
        connected_at: new Date(),
      })
      log.info({ accountId: this.deps.accountId, jid }, 'whatsapp conectado')
      return
    }

    if (connection !== 'close') return

    const status = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode

    // loggedOut: el cliente cerró sesión desde el celular. Reintentar es inútil
    // y encima sospechoso. Hay que avisarle que vuelva a escanear.
    if (status === DisconnectReason.loggedOut) {
      await this.auth?.clear()
      await this.setStatus('logged_out', {
        external_id: null,
        qr: null,
        last_error: 'La sesión se cerró desde el teléfono. Hay que escanear de nuevo.',
      })
      this.stopped = true
      return
    }

    // 403: casi siempre es baneo del número. Tampoco se reintenta.
    if (status === DisconnectReason.forbidden) {
      await this.setStatus('banned', {
        qr: null,
        last_error: 'WhatsApp bloqueó este número.',
      })
      this.stopped = true
      log.error({ accountId: this.deps.accountId }, 'número bloqueado por WhatsApp')
      return
    }

    // 515: Baileys pide reinicio del socket tras el pairing. Es normal y va sin espera.
    if (status === DisconnectReason.restartRequired) {
      void this.connect()
      return
    }

    // El resto (428 cerrada, 408 timeout, 440 reemplazada, 503) sí se reintenta.
    await this.scheduleReconnect(status)
  }

  private async scheduleReconnect(status?: number): Promise<void> {
    if (this.stopped) return
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_MAX_MS)
    this.attempt += 1
    await this.setStatus('disconnected', {
      last_error: `Desconectado (código ${status ?? 'desconocido'}). Reintentando…`,
    })
    log.warn(
      { accountId: this.deps.accountId, status, delay, attempt: this.attempt },
      'reconectando',
    )
    setTimeout(() => void this.connect(), delay)
  }

  // -------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------

  private async onMessages(payload: {
    messages: proto.IWebMessageInfo[]
    type: string
  }): Promise<void> {
    // `append` = historial que WhatsApp replica al conectar. NO se procesa como
    // mensaje nuevo: contestarle de golpe a cientos de pacientes viejos es el
    // desastre más difícil de explicar que hay. Ver CLAUDE.md.
    if (payload.type !== 'notify') return

    for (const msg of payload.messages) {
      if (msg.key.fromMe) continue
      const jid = msg.key.remoteJid
      if (!jid) continue
      // Los estados y las difusiones no son conversaciones.
      if (jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue

      await this.pushToIngest(msg)
    }
  }

  private async pushToIngest(msg: proto.IWebMessageInfo): Promise<void> {
    // El id del mensaje ES el id del evento: la idempotencia se resuelve del
    // otro lado con INSERT ... ON CONFLICT DO NOTHING sobre webhook_events.
    const eventId = `baileys:${msg.key.id}`
    const body = {
      eventId,
      kind: 'message.inbound',
      tenantId: this.deps.tenantId,
      accountId: this.deps.accountId,
      accountJid: this.sock?.user?.id ?? null,
      message: msg,
    }

    try {
      const res = await fetch(this.deps.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.deps.ingestSecret}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        log.error(
          { accountId: this.deps.accountId, status: res.status, eventId },
          'la ingesta rechazó el evento',
        )
      }
    } catch (err) {
      // Si la app está caída, el mensaje ya está en el teléfono del cliente pero
      // no en la base. El barrido de recuperación lo levanta después.
      log.error({ err, eventId }, 'no se pudo entregar a la ingesta')
    }
  }

  // -------------------------------------------------------------------
  // Salida — cola serializada con jitter
  // -------------------------------------------------------------------

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      let job: OutboundJob | undefined
      while ((job = this.queue.shift())) {
        const wait = this.nextDelay()
        if (wait > 0) await sleep(wait)

        try {
          const sent = await this.sock?.sendMessage(job.to, { text: job.text })
          this.lastSentAt = Date.now()
          await this.deps.pool.query(
            `update messages
                set status = 'sent', external_id = $2, sent_at = now()
              where id = $1`,
            [job.messageId, sent?.key?.id ?? null],
          )
        } catch (err) {
          await this.deps.pool.query(
            `update messages set status = 'failed', error = $2 where id = $1`,
            [job.messageId, String(err)],
          )
          log.error({ err, messageId: job.messageId }, 'falló el envío')
        }
      }
    } finally {
      this.draining = false
    }
  }

  private nextDelay(): number {
    const gap = SEND_MIN_MS + Math.random() * (SEND_MAX_MS - SEND_MIN_MS)
    const elapsed = Date.now() - this.lastSentAt
    return Math.max(0, gap - elapsed)
  }

  // -------------------------------------------------------------------

  private async setStatus(
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const fields: Record<string, unknown> = {
      status,
      last_seen_at: new Date(),
      ...extra,
    }
    // Los nombres de columna vienen solo de código nuestro, nunca del request:
    // igual los filtramos contra una lista blanca antes de interpolarlos.
    const keys = Object.keys(fields).filter((k) => ALLOWED_STATUS_FIELDS.has(k))
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')
    await this.deps.pool.query(
      `update channel_accounts set ${sets} where id = $1`,
      [this.deps.accountId, ...keys.map((k) => fields[k])],
    )
  }
}

const ALLOWED_STATUS_FIELDS = new Set([
  'status',
  'last_seen_at',
  'external_id',
  'phone',
  'qr',
  'qr_expires_at',
  'last_error',
  'connected_at',
])

/** "5493511234567:12@s.whatsapp.net" → "5493511234567" */
function phoneFromJid(jid: string): string | null {
  const user = jid.split('@')[0]
  if (!user) return null
  return user.split(':')[0] ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
