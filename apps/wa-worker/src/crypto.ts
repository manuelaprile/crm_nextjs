/**
 * Cifrado del material de sesión de WhatsApp.
 *
 * Por qué existe: `wa_session_keys` contiene las credenciales que permiten
 * hacerse pasar por el WhatsApp de cada cliente. Si esa tabla viaja en texto
 * plano, cualquiera con un volcado de la base —un backup mal guardado, un
 * empleado, un Postgres expuesto— se lleva las sesiones de TODOS los
 * clientes. Es el peor escenario del sistema y es barato de evitar.
 *
 * Esquema: AES-256-GCM con clave de 32 bytes fuera de la base. GCM además de
 * cifrar autentica: si alguien modifica el texto cifrado, el descifrado falla
 * en vez de devolver basura silenciosa.
 *
 * ======================================================================
 * DOS CLAVES: ROTACIÓN SIN CORTE
 * ======================================================================
 * `SESSION_ENC_KEY`      la clave actual. Con esta se CIFRA todo lo nuevo.
 * `SESSION_ENC_KEY_PREV` la anterior, opcional. Solo se usa para DESCIFRAR.
 *
 * Eso permite cambiar la clave sin que nadie tenga que re-escanear el QR:
 * se pone la vieja en PREV, la nueva en la principal, y a medida que cada
 * sesión se guarda de nuevo queda re-cifrada con la nueva. Cuando ya no
 * queda nada con la vieja, se borra PREV.
 *
 * Sin esto, cambiar la clave significaba que todos los clientes volvieran a
 * vincular su WhatsApp.
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

let claveActual: Buffer | null = null
let clavePrevia: Buffer | null | undefined

function leerClave(nombre: string, obligatoria: boolean): Buffer | null {
  const raw = process.env[nombre]
  if (!raw) {
    if (!obligatoria) return null
    // Fail-closed. Arrancar sin clave y guardar en plano "para probar" es
    // exactamente como terminan las bases con credenciales en texto plano.
    throw new Error(`Falta ${nombre}. Generala con: openssl rand -base64 32`)
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `${nombre} debe ser de 32 bytes en base64 (son ${buf.length}). ` +
        'Generala con: openssl rand -base64 32',
    )
  }
  return buf
}

function key(): Buffer {
  if (!claveActual) claveActual = leerClave('SESSION_ENC_KEY', true)!
  return claveActual
}

function keyPrevia(): Buffer | null {
  if (clavePrevia === undefined) {
    clavePrevia = leerClave('SESSION_ENC_KEY_PREV', false)
  }
  return clavePrevia
}

/** Verifica al arrancar que la clave está y funciona, en vez de fallar al primer login. */
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

function abrirCon(sealed: SealedValue, clave: Buffer): string {
  const decipher = createDecipheriv(ALGO, clave, Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function open<T>(sealed: SealedValue): T {
  if (sealed.v !== VERSION) {
    throw new Error(`Versión de cifrado desconocida: ${sealed.v}`)
  }
  try {
    return JSON.parse(abrirCon(sealed, key())) as T
  } catch (err) {
    // Con GCM, una clave equivocada falla la verificación de autenticidad.
    // Antes de darlo por perdido, se prueba con la clave anterior: puede ser
    // un dato cifrado antes de una rotación.
    const previa = keyPrevia()
    if (previa) {
      try {
        return JSON.parse(abrirCon(sealed, previa)) as T
      } catch {
        /* tampoco: se propaga el error original */
      }
    }
    throw err
  }
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
