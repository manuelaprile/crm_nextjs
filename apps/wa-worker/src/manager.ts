/**
 * Mantiene N sesiones de WhatsApp vivas, una por cuenta conectada.
 *
 * Presupuesto de memoria: ~80MB por sesión activa. Un VPS de 4GB aguanta
 * cómodo ~20 clientes; pasado eso hay que partir el worker en varios procesos
 * y rutear por accountId. Está pensado para eso: el manager no tiene estado
 * global, así que correr dos instancias con particiones distintas ya funciona.
 */
import type { Pool } from 'pg'
import pino from 'pino'
import { WhatsAppSession, type OutboundJob } from './session.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

export class SessionManager {
  private sessions = new Map<string, WhatsAppSession>()

  constructor(
    private readonly pool: Pool,
    private readonly ingestUrl: string,
    private readonly ingestSecret: string,
  ) {}

  /**
   * Levanta al arrancar las cuentas que estaban conectadas.
   *
   * Las que quedaron en `logged_out`, `banned` o `qr_pending` NO se reintentan
   * solas: necesitan intervención humana y reintentarlas es sospechoso. El
   * `qr_pending` es el caso más fácil de pasar por alto — es un QR que nadie
   * llegó a escanear, así que reconectar solo agrega intentos fallidos contra
   * WhatsApp sin que nadie esté mirando la pantalla para escanear el nuevo.
   */
  async restoreAll(): Promise<void> {
    let rows: { id: string; tenant_id: string }[]
    try {
      const res = await this.pool.query(
        `select ca.id, ca.tenant_id
           from channel_accounts ca
           join tenants t on t.id = ca.tenant_id
          where ca.provider = 'baileys'
            and ca.status in ('connected','connecting')
            and t.status in ('trial','active')`,
      )
      rows = res.rows
    } catch (err) {
      // 42P01 = la tabla no existe. Pasa siempre en un despliegue nuevo: el
      // worker arranca junto con la base, antes de que se corran las
      // migraciones. Antes esto tiraba el proceso y quedaba en bucle de
      // reinicio, con un stack trace que parecía una falla grave.
      // Ahora avisa qué falta y sigue vivo: cuando el operador corra las
      // migraciones, alcanza con reiniciar el contenedor.
      if ((err as { code?: string }).code === '42P01') {
        log.warn(
          'Las tablas todavía no existen. Corré las migraciones y después ' +
            'reiniciá este servicio: docker compose restart wa-worker',
        )
        return
      }
      throw err
    }

    log.info({ count: rows.length }, 'restaurando sesiones')
    for (const row of rows) {
      await this.ensure(row.id, row.tenant_id)
    }
  }

  /**
   * Devuelve la sesión de la cuenta, levantándola si hace falta.
   *
   * El `detenida` no es un detalle: una sesión que se cerró (logout desde el
   * teléfono, baneo, reemplazo) sigue en el mapa pero con el socket muerto.
   * Sin este chequeo, "Conectar" desde el panel encontraba ese cascarón, lo
   * devolvía como si estuviera todo bien, y la pantalla se quedaba en
   * "Conectando…" para siempre porque nadie volvía a abrir el socket. La única
   * salida era reiniciar el contenedor.
   */
  async ensure(accountId: string, tenantId: string): Promise<WhatsAppSession> {
    const existing = this.sessions.get(accountId)
    if (existing && !existing.detenida) {
      // Viva pero sin conectar: hay un reintento programado y puede faltar
      // mucho para que salte. Quien apretó el botón quiere que sea ahora.
      if (!existing.conectada) await existing.reintentarYa()
      return existing
    }
    if (existing) {
      log.info({ accountId }, 'reviviendo sesión detenida')
      await existing.stop()
      this.sessions.delete(accountId)
    }

    const session = new WhatsAppSession({
      pool: this.pool,
      accountId,
      tenantId,
      ingestUrl: this.ingestUrl,
      ingestSecret: this.ingestSecret,
    })
    this.sessions.set(accountId, session)
    await session.start()
    return session
  }

  get(accountId: string): WhatsAppSession | undefined {
    return this.sessions.get(accountId)
  }

  async disconnect(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId)
    if (!session) return
    await session.stop()
    this.sessions.delete(accountId)
  }

  /**
   * Desvincular el número. Es la salida de emergencia de cualquier sesión
   * envenenada, así que tiene que funcionar SIEMPRE.
   *
   * Antes salía de una si no había sesión en memoria — por ejemplo después de
   * reiniciar el worker. El botón "Desconectar" del panel no hacía nada, las
   * credenciales rotas seguían en Postgres, y no quedaba forma de volver a
   * empezar sin entrar a la base a mano.
   */
  async logout(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId)
    if (session) {
      await session.logout()
      this.sessions.delete(accountId)
      return
    }

    await this.pool.query('delete from wa_session_keys where account_id = $1', [
      accountId,
    ])
    await this.pool.query(
      `update channel_accounts
          set status = 'logged_out', qr = null, qr_expires_at = null,
              external_id = null, last_error = null, last_seen_at = now()
        where id = $1`,
      [accountId],
    )
    log.info({ accountId }, 'sesión borrada sin socket vivo')
  }

  send(accountId: string, job: OutboundJob): boolean {
    const session = this.sessions.get(accountId)
    if (!session) return false
    session.enqueue(job)
    return true
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.stop()))
    this.sessions.clear()
  }

  get size(): number {
    return this.sessions.size
  }
}
