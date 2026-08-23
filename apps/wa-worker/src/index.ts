/**
 * API interna del worker de WhatsApp.
 *
 * Solo la habla Next.js, por la red interna de Docker. NO se expone a internet:
 * Caddy no rutea nada hacia el puerto del worker. Igual va autenticada con un
 * bearer compartido, porque "está en la red interna" deja de ser cierto el día
 * que alguien levanta otro contenedor.
 */
import http from 'node:http'
import { existsSync } from 'node:fs'
import { Pool } from 'pg'
import pino from 'pino'
import { SessionManager } from './manager.js'
import { assertEncryptionReady, safeEqual } from './crypto.js'

// Carga el .env de la carpeta del worker, si existe. `loadEnvFile` viene con
// Node 20.12+: no hace falta la dependencia `dotenv`.
// En el servidor no hay .env — las variables las pone docker-compose — así
// que la ausencia del archivo es normal y no es un error.
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const PORT = Number(process.env.WORKER_PORT ?? 4000)
const SECRET = required('WORKER_SECRET')
const INGEST_URL = required('INGEST_URL')
const INGEST_SECRET = required('INGEST_SECRET')

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    // Fail-closed: un secreto vacío que acepta todo es peor que no arrancar.
    throw new Error(`Falta la variable de entorno ${name}`)
  }
  return v
}

const pool = new Pool({
  connectionString: required('WORKER_DATABASE_URL'),
  max: 10,
})

const manager = new SessionManager(pool, INGEST_URL, INGEST_SECRET)

function authorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return safeEqual(token, SECRET)
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://internal')

  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, sessions: manager.size })
  }

  if (!authorized(req)) return json(res, 401, { error: 'no autorizado' })

  try {
    // Conectar / reconectar una cuenta. Devuelve enseguida: el QR aparece
    // después en channel_accounts y el panel lo levanta por polling.
    if (req.method === 'POST' && url.pathname === '/sessions/connect') {
      const { accountId, tenantId } = await readJson<{
        accountId: string
        tenantId: string
      }>(req)
      await manager.ensure(accountId, tenantId)
      return json(res, 202, { ok: true })
    }

    // Cortar el socket sin desvincular el número. Al reconectar no pide QR.
    if (req.method === 'POST' && url.pathname === '/sessions/disconnect') {
      const { accountId } = await readJson<{ accountId: string }>(req)
      await manager.disconnect(accountId)
      return json(res, 200, { ok: true })
    }

    // Desvincular de verdad. Después de esto hay que escanear otra vez.
    if (req.method === 'POST' && url.pathname === '/sessions/logout') {
      const { accountId } = await readJson<{ accountId: string }>(req)
      await manager.logout(accountId)
      return json(res, 200, { ok: true })
    }

    // Único camino de salida. La fila en `messages` ya la creó la app: acá solo
    // se encola el envío y el worker actualiza estado y external_id.
    if (req.method === 'POST' && url.pathname === '/messages/send') {
      const job = await readJson<{
        accountId: string
        to: string
        text: string
        messageId: string
      }>(req)
      const queued = manager.send(job.accountId, {
        to: job.to,
        text: job.text,
        messageId: job.messageId,
      })
      if (!queued) return json(res, 409, { error: 'la sesión no está conectada' })
      return json(res, 202, { ok: true })
    }

    return json(res, 404, { error: 'no encontrado' })
  } catch (err) {
    log.error({ err, path: url.pathname }, 'error en el worker')
    return json(res, 500, { error: 'error interno' })
  }
})

// Se verifica ANTES de escuchar: si el cifrado no funciona, el proceso no
// arranca. Descubrirlo al primer escaneo de QR sería mucho peor.
assertEncryptionReady()
log.info('cifrado de sesiones verificado')

server.listen(PORT, async () => {
  log.info({ port: PORT }, 'wa-worker escuchando')
  await manager.restoreAll()
})

async function shutdown(signal: string) {
  log.info({ signal }, 'cerrando')
  server.close()
  await manager.shutdown()
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
