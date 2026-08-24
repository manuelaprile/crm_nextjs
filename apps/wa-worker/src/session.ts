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
  isLidUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type Contact,
  type WAMessageKey,
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
/**
 * Tope mucho más corto mientras el número todavía no se vinculó.
 *
 * Con el tope de 5 minutos, alguien parado frente a la pantalla esperando el
 * QR ve "Reintentando…" y no pasa nada durante minutos. Cinco minutos de
 * silencio son razonables para un número conectado que perdió internet a las
 * 3 de la mañana; son inaceptables para alguien que acaba de apretar Conectar.
 */
const BACKOFF_VINCULANDO_MAX_MS = 15_000
/** Un QR de WhatsApp vive ~60s; damos margen para el refresh. */
const QR_TTL_MS = 75_000

/**
 * Ventana entre mensajes salientes. La ráfaga es lo que dispara el baneo:
 * un humano no manda 40 mensajes en 10 segundos. El jitter evita además el
 * patrón perfectamente regular, que también es señal de bot.
 */
const SEND_MIN_MS = 3_000
const SEND_MAX_MS = 8_000

/**
 * Pedirle al teléfono todo el historial que quiera dar, al vincular.
 *
 * Llega SOLO en la primera conexión después de escanear el QR: no hay forma
 * de pedirlo más tarde.
 *
 * Lo que se consigue es lo que ve WhatsApp Web —los chats con sus mensajes
 * recientes—, no el archivo completo de años. Para eso habría que decir que
 * somos la aplicación de escritorio, y hoy WhatsApp cierra la conexión de una
 * si lo hacemos: ver el comentario largo en `browser`, abajo.
 */
const SYNC_FULL_HISTORY = process.env.WA_SYNC_FULL_HISTORY !== 'false'

/**
 * Mensajes por POST al ingestar historial. El sync llega en tandas que pueden
 * ser de miles: mandarlas enteras es un JSON de decenas de MB que se cae por
 * timeout y se pierde el lote completo.
 */
const HISTORY_CHUNK = 200

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
  /** El reintento pendiente, para poder cancelarlo y no apilar timers. */
  private reintento?: ReturnType<typeof setTimeout>
  /** Si el socket llegó a abrirse alguna vez. Cambia el tope del backoff. */
  private abierta = false
  /**
   * Cola de escrituras de credenciales. Baileys emite `creds.update` varias
   * veces durante el pairing y cada una tiene que pisar a la anterior EN
   * ORDEN. Sin esta cadena, dos escrituras concurrentes pueden dejar en
   * Postgres una credencial vieja y la sesión muere al primer reinicio.
   */
  private guardando: Promise<void> = Promise.resolve()

  constructor(private readonly deps: SessionDeps) {}

  get accountId() {
    return this.deps.accountId
  }

  /** Una sesión frenada (logout, baneo, o parada a mano) no revive sola. */
  get detenida() {
    return this.stopped
  }

  /** Si el socket está abierto ahora mismo. */
  get conectada() {
    return this.abierta
  }

  async start(): Promise<void> {
    this.stopped = false
    this.attempt = 0
    await this.connect()
  }

  /**
   * Reintentar YA, porque una persona apretó "Conectar".
   *
   * Sin esto, apretar el botón mientras hay un reintento programado no hacía
   * absolutamente nada: la sesión estaba viva, así que el manager la devolvía
   * tal cual, y la pantalla se quedaba en "Reintentando…" hasta que venciera
   * el backoff — que después de unos pocos intentos ya son varios minutos.
   * Desde afuera es idéntico a un botón roto.
   *
   * Además, si las credenciales quedaron a medio negociar (`registered` en
   * false: se generó un QR que nadie escaneó, o el escaneo se cortó por la
   * mitad) se tiran a la basura. No sirven para nada y son la causa típica de
   * que el servidor cierre la conexión apenas se abre. Lo que la persona
   * quiere al apretar Conectar es un QR nuevo y limpio.
   */
  async reintentarYa(): Promise<void> {
    clearTimeout(this.reintento)
    this.reintento = undefined
    this.attempt = 0
    this.stopped = false

    if (this.auth && !this.auth.state.creds.registered) {
      log.info(
        { accountId: this.deps.accountId },
        'credenciales a medio vincular: se descartan y se pide un QR nuevo',
      )
      await this.auth.clear()
      this.auth = undefined
    }

    try {
      this.sock?.end(undefined)
    } catch {
      /* ya estaba muerto */
    }
    this.sock = undefined
    await this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.reintento)
    this.reintento = undefined
    this.abierta = false
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
    this.auth = undefined
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

    try {
      // El auth state se crea UNA vez por sesión y se reusa en cada reconexión.
      //
      // Antes se releía de Postgres en cada `connect()`, y ahí estaba el bug
      // que cerraba la sesión a los pocos minutos de escanear: al terminar el
      // pairing, WhatsApp cierra con 515 (restartRequired) y hay que volver a
      // conectar YA. La escritura de las credenciales nuevas todavía estaba en
      // vuelo, así que la relectura traía las viejas, el socket se registraba
      // con credenciales a medio negociar y WhatsApp lo echaba con `loggedOut`.
      // Desde el panel se veía como "se desconectó solo y no vuelve".
      if (!this.auth) {
        this.auth = await usePostgresAuthState(this.deps.pool, this.deps.accountId)
      }

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
        // NO cambiar esto a 'Mac OS' ni a 'Windows'.
        //
        // Es tentador: Baileys manda `webSubPlatform: DARWIN/WIN32` cuando el
        // navegador es uno de esos dos Y `syncFullHistory` está prendido, y esa
        // es la única forma de pedirle a WhatsApp el archivo histórico
        // completo. El problema es que WhatsApp hoy rechaza a los clientes que
        // dicen ser la aplicación de escritorio: cierra el stream con 428
        // ANTES de emitir el primer QR, así que el número no se puede vincular.
        //
        // Medido el 24/8/2026 contra los servidores reales: 'Mac OS'+Desktop,
        // 'Windows'+Desktop y 'Mac OS'+Chrome con full sync cerraron con 428 y
        // cero QR, dos veces cada uno; 'Ubuntu'+Chrome llegó al QR siempre.
        browser: Browsers.ubuntu('Chrome'),
        logger: log.child({ accountId: this.deps.accountId }),
        // No marcamos en línea al conectar: si no, WhatsApp deja de mandar
        // notificaciones push al celular del cliente y se queja.
        markOnlineOnConnect: false,
        syncFullHistory: SYNC_FULL_HISTORY,
        generateHighQualityLinkPreview: false,
      })

      this.sock.ev.on('creds.update', () => {
        void this.guardarCreds()
      })

      this.sock.ev.on('connection.update', (update) => {
        void this.onConnectionUpdate(update)
      })

      this.sock.ev.on('messages.upsert', (payload) => {
        void this.onMessages(payload)
      })

      // El historial que replica el teléfono al vincular. Llega en tandas, a
      // lo largo de varios minutos, y solo la primera vez.
      this.sock.ev.on('messaging-history.set', (payload) => {
        void this.onHistory(payload)
      })
    } catch (err) {
      // Si esto queda sin catch, el estado se queda en `connecting` para
      // siempre y el panel muestra "Conectando…" hasta que alguien reinicie el
      // contenedor. Cualquier falla acá es reintentable: casi siempre es
      // Postgres que todavía no está listo.
      log.error({ err, accountId: this.deps.accountId }, 'no se pudo abrir el socket')
      await this.scheduleReconnect()
    }
  }

  /**
   * Persiste las credenciales, una escritura por vez y en orden.
   * Devuelve la promesa para poder esperarla antes de reconectar.
   */
  private guardarCreds(): Promise<void> {
    this.guardando = this.guardando
      .catch(() => {})
      .then(() => this.auth?.saveCreds() ?? Promise.resolve())
      .catch((err) => {
        // Perder esta escritura significa perder la sesión en el próximo
        // reinicio. Tiene que quedar en el log sí o sí.
        log.error(
          { err, accountId: this.deps.accountId },
          'NO se pudieron guardar las credenciales de WhatsApp',
        )
      })
    return this.guardando
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
        // Hay un QR nuevo esperando: el error del intento anterior ya no
        // describe nada. Dejarlo puesto muestra "Desconectado (código 408)"
        // al lado de un código perfectamente escaneable.
        last_error: null,
      })
    }

    if (connection === 'open') {
      this.attempt = 0
      this.abierta = true
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
    this.abierta = false

    const status = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode

    // loggedOut: el cliente cerró sesión desde el celular. Reintentar es inútil
    // y encima sospechoso. Hay que avisarle que vuelva a escanear.
    if (status === DisconnectReason.loggedOut) {
      await this.auth?.clear()
      this.auth = undefined
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

    // 515: Baileys pide reinicio del socket tras el pairing. Es normal, pero
    // NO va sin esperar: primero se termina de escribir la credencial que
    // acaba de negociarse, si no el socket nuevo levanta la anterior.
    if (status === DisconnectReason.restartRequired) {
      await this.guardando
      void this.connect()
      return
    }

    // 440: otra conexión tomó estas mismas credenciales. Reintentar acá es una
    // guerra: cada reconexión expulsa a la otra punta y la otra punta expulsa
    // a esta, para siempre. Se corta y se avisa.
    if (status === DisconnectReason.connectionReplaced) {
      await this.setStatus('disconnected', {
        qr: null,
        last_error:
          'Otra sesión tomó el lugar de esta. Si el número quedó sin ' +
          'atender, apretá Conectar de nuevo.',
      })
      this.stopped = true
      log.warn({ accountId: this.deps.accountId }, 'conexión reemplazada')
      return
    }

    // El resto (428 cerrada, 408 timeout, 503) sí se reintenta.
    await this.scheduleReconnect(status)
  }

  private async scheduleReconnect(status?: number): Promise<void> {
    if (this.stopped) return
    // Mientras no se vinculó hay alguien mirando la pantalla: el tope es de
    // segundos, no de minutos. Una vez conectado, el tope largo evita
    // martillar a WhatsApp durante una caída de red.
    const tope = this.abierta || this.auth?.state.creds.registered
      ? BACKOFF_MAX_MS
      : BACKOFF_VINCULANDO_MAX_MS
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, tope)
    this.attempt += 1
    await this.setStatus('disconnected', {
      last_error: `Desconectado (código ${status ?? 'desconocido'}). ` +
        `Reintentando en ${Math.round(delay / 1000)}s…`,
    })
    log.warn(
      { accountId: this.deps.accountId, status, delay, attempt: this.attempt },
      'reconectando',
    )
    // Uno solo a la vez: sin cancelar el anterior se apilan timers y terminan
    // abriendo varios sockets con las mismas credenciales, que es justo lo que
    // hace que WhatsApp cierre la conexión.
    clearTimeout(this.reintento)
    this.reintento = setTimeout(() => void this.connect(), delay)
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
      if (!conversable(msg.key.remoteJid)) continue
      await this.pushToIngest(msg)
    }
  }

  /**
   * El historial que el teléfono replica al vincular.
   *
   * Va por una ruta distinta a la de los mensajes nuevos y con otro `kind`,
   * porque la app tiene que tratarlo distinto: sin contador de no leídos, sin
   * despertar al agente, y sin pisar el estado de conversaciones que ya
   * existen. Contestarle a un historial de dos años es el peor accidente
   * posible de este sistema.
   */
  private async onHistory(payload: {
    chats: unknown[]
    contacts: Contact[]
    messages: proto.IWebMessageInfo[]
    isLatest?: boolean
    progress?: number | null
  }): Promise<void> {
    const mensajes = payload.messages.filter((m) => conversable(m.key.remoteJid))

    log.info(
      {
        accountId: this.deps.accountId,
        chats: payload.chats?.length ?? 0,
        contactos: payload.contacts?.length ?? 0,
        mensajes: mensajes.length,
        progreso: payload.progress ?? null,
      },
      'historial de WhatsApp',
    )

    const contactos = (payload.contacts ?? [])
      .filter((c) => c.id && (c.name || c.notify || c.verifiedName))
      .map((c) => ({
        jid: c.id,
        lid: c.lid ?? (isLidUser(c.id) ? c.id : undefined),
        pn: c.jid ?? (isLidUser(c.id) ? undefined : c.id),
        name: c.name ?? c.verifiedName ?? c.notify ?? null,
      }))

    for (let i = 0; i < mensajes.length; i += HISTORY_CHUNK) {
      const tanda = mensajes.slice(i, i + HISTORY_CHUNK)
      await this.post({
        eventId: `hist:${this.deps.accountId}:${huella(
          tanda.map((m) => m.key.id ?? ''),
        )}`,
        kind: 'history.messages',
        tenantId: this.deps.tenantId,
        accountId: this.deps.accountId,
        accountJid: this.sock?.user?.id ?? null,
        messages: tanda.map((m) => ({ ...m, key: conIdentidad(m.key) })),
      })
    }
    // La agenda va DESPUÉS de los mensajes, no antes: solo puede ponerle
    // nombre a contactos que ya existen, y los contactos los crea la tanda
    // de mensajes de arriba. Mandándola primero no encontraba a nadie.
    if (contactos.length) {
      await this.post({
        eventId: `hist-ag:${this.deps.accountId}:${huella(contactos.map((c) => c.jid))}`,
        kind: 'history.contacts',
        tenantId: this.deps.tenantId,
        accountId: this.deps.accountId,
        accountJid: this.sock?.user?.id ?? null,
        contacts: contactos,
      })
    }

  }

  private async pushToIngest(msg: proto.IWebMessageInfo): Promise<void> {
    // El id del mensaje ES el id del evento: la idempotencia se resuelve del
    // otro lado con INSERT ... ON CONFLICT DO NOTHING sobre webhook_events.
    await this.post({
      eventId: `baileys:${msg.key.id}`,
      kind: 'message.inbound',
      tenantId: this.deps.tenantId,
      accountId: this.deps.accountId,
      accountJid: this.sock?.user?.id ?? null,
      message: { ...msg, key: conIdentidad(msg.key) },
    })
  }

  private async post(body: Record<string, unknown>): Promise<void> {
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
          {
            accountId: this.deps.accountId,
            status: res.status,
            eventId: body.eventId,
          },
          'la ingesta rechazó el evento',
        )
      }
    } catch (err) {
      // Si la app está caída, el mensaje ya está en el teléfono del cliente pero
      // no en la base. El barrido de recuperación lo levanta después.
      log.error({ err, eventId: body.eventId }, 'no se pudo entregar a la ingesta')
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

/**
 * Le agrega a la clave del mensaje el JID con el número real.
 *
 * WhatsApp está migrando las conversaciones a LID (`123456789012345@lid`), un
 * identificador anónimo que NO es un teléfono. Si se lo guarda como si lo
 * fuera, la ficha del contacto queda con quince dígitos inventados y nadie lo
 * puede llamar. El número verdadero viaja aparte, en `senderPn`.
 *
 * `senderPn` no siempre viene. Cuando falta se manda `null` y la app se queda
 * con lo que tenga: es mejor un contacto sin teléfono que uno con un teléfono
 * falso.
 */
function conIdentidad(key: WAMessageKey) {
  const chat = key.remoteJid ?? undefined
  const pn = key.senderPn ?? (chat && !isLidUser(chat) ? chat : undefined)
  return {
    ...key,
    // Normalizado: sin el sufijo de dispositivo (":12") que rompe la unicidad.
    phoneJid: pn ? jidNormalizedUser(pn) : null,
    lidJid: chat && isLidUser(chat) ? jidNormalizedUser(chat) : null,
  }
}

/** Los estados, las difusiones y los canales no son conversaciones. */
function conversable(jid: string | null | undefined): jid is string {
  if (!jid) return false
  if (jid === 'status@broadcast') return false
  if (jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return false
  return true
}

/**
 * Huella estable de una tanda, para que un reenvío del mismo lote no se
 * duplique. No necesita ser criptográfica: si dos tandas distintas colisionan,
 * los mensajes igual se deduplican por `external_id` del otro lado.
 */
function huella(ids: string[]): string {
  let h = 2166136261
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return (h >>> 0).toString(36) + '-' + ids.length
}

/** "5493511234567:12@s.whatsapp.net" → "5493511234567" */
function phoneFromJid(jid: string): string | null {
  const user = jid.split('@')[0]
  if (!user) return null
  return user.split(':')[0] ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
