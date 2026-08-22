/**
 * Cifrado de secretos guardados en la base (claves de API de los clientes).
 *
 * Mismo esquema que el worker (`apps/wa-worker/src/crypto.ts`) y la MISMA
 * clave: AES-256-GCM, `SESSION_ENC_KEY`, sobre `{v, iv, tag, ct}`.
 *
 * Se duplica el archivo a propósito en vez de compartir un paquete: son dos
 * aplicaciones que se despliegan por separado, y un paquete compartido para
 * 80 líneas agrega una capa de build sin beneficio. Si se toca una, tocar la
 * otra — está anotado en los dos archivos.
 *
 * GCM además de cifrar autentica: si alguien edita el ciphertext en la base,
 * el descifrado falla en vez de devolver basura.
 */
import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const VERSION = 1

export type SealedValue = { v: number; iv: string; tag: string; ct: string }

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.SESSION_ENC_KEY
  if (!raw) {
    throw new Error('Falta SESSION_ENC_KEY. Generala con: openssl rand -base64 32')
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `SESSION_ENC_KEY debe ser de 32 bytes en base64 (son ${buf.length}).`,
    )
  }
  cachedKey = buf
  return buf
}

export function seal(value: string): SealedValue {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    v: VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  }
}

export function open(sealed: SealedValue): string {
  if (sealed.v !== VERSION) throw new Error(`Versión de cifrado desconocida: ${sealed.v}`)
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function isSealed(value: unknown): value is SealedValue {
  return (
    typeof value === 'object' && value !== null &&
    'v' in value && 'iv' in value && 'tag' in value && 'ct' in value
  )
}

/** "sk-proj-abc...xyz" -> "sk-proj-…4f2a". Para mostrar sin revelar. */
export function hintFor(apiKey: string): string {
  const clean = apiKey.trim()
  if (clean.length < 12) return '…'
  return `${clean.slice(0, 7)}…${clean.slice(-4)}`
}
