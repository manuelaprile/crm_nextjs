/**
 * Cifrado del material de sesión de WhatsApp.
 *
 * Por qué existe: `wa_session_keys` contiene las credenciales que permiten
 * hacerse pasar por el WhatsApp de cada cliente. Si esa tabla viaja en texto
 * plano, cualquiera con un dump de la base —un backup mal guardado, un
 * empleado, un Postgres expuesto— se lleva las sesiones de TODOS los clientes.
 * Es el peor escenario del sistema, y es barato de evitar.
 *
 * Esquema: AES-256-GCM con clave de 32 bytes fuera de la base (variable de
 * entorno / secret del VPS). GCM porque además de cifrar autentica: si alguien
 * modifica el ciphertext en la base, el descifrado falla en vez de devolver
 * basura silenciosa.
 *
 * El campo `v` es la versión del esquema: permite rotar la clave o cambiar el
 * algoritmo más adelante sin romper las filas viejas.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12 // recomendado para GCM
const VERSION = 1

export type SealedValue = {
  v: number
  iv: string
  tag: string
  ct: string
}

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.SESSION_ENC_KEY
  if (!raw) {
    // Fail-closed. Arrancar sin clave y guardar en plano "para probar" es
    // exactamente como terminan las bases con credenciales en texto plano.
    throw new Error(
      'Falta SESSION_ENC_KEY. Generala con: openssl rand -base64 32',
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `SESSION_ENC_KEY debe ser de 32 bytes en base64 (son ${buf.length}). ` +
        'Generala con: openssl rand -base64 32',
    )
  }
  cachedKey = buf
  return buf
}

/** Verifica al arrancar que la clave está y es válida, en vez de fallar al primer login. */
export function assertEncryptionReady(): void {
  const probe = seal('ok')
  if (open<string>(probe) !== 'ok') {
    throw new Error('El cifrado de sesiones no está funcionando correctamente')
  }
}

export function seal(value: unknown): SealedValue {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key(), iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    v: VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  }
}

export function open<T>(sealed: SealedValue): T {
  if (sealed.v !== VERSION) {
    throw new Error(`Versión de cifrado desconocida: ${sealed.v}`)
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8')) as T
}

/** ¿La fila que leímos está cifrada, o es una fila vieja en texto plano? */
export function isSealed(value: unknown): value is SealedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    'iv' in value &&
    'tag' in value &&
    'ct' in value
  )
}

/** Comparación de secretos en tiempo constante, con chequeo de longitud previo. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
