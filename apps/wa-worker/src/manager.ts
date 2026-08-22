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
   * Las que quedaron en `logged_out` o `banned` NO se reintentan solas:
   * necesitan intervención humana y reintentarlas es sospechoso.
   */
  async restoreAll(): Promise<void> {
    const { rows } = await this.pool.query(
      `select ca.id, ca.tenant_id
         from channel_accounts ca
         join tenants t on t.id = ca.tenant_id
        where ca.provider = 'baileys'
          and ca.status in ('connected','connecting','disconnected')
          and t.status in ('trial','active')`,
    )
    log.info({ count: rows.length }, 'restaurando sesiones')
    for (const row of rows) {
      await this.ensure(row.id, row.tenant_id)
    }
  }

  async ensure(accountId: string, tenantId: string): Promise<WhatsAppSession> {
    const existing = this.sessions.get(accountId)
    if (existing) return existing

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

  async logout(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId)
    if (!session) return
    await session.logout()
    this.sessions.delete(accountId)
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
