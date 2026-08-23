/**
 * Verificación de que la clave de cifrado es la correcta.
 *
 * El problema que resuelve: si SESSION_ENC_KEY cambia —porque alguien
 * recreó el .env, restauró un backup viejo, o desplegó en otro servidor sin
 * copiarla— el sistema arranca perfecto y todo parece normal. El fallo
 * aparece recién cuando un cliente usa su WhatsApp, y se manifiesta como
 * "la sesión no levanta": nadie sospecha de la clave.
 *
 * El canario es un valor conocido, cifrado con la clave, guardado en la
 * base. Al arrancar se intenta descifrar:
 *
 *   - No existe          → primera vez. Se crea. Todo bien.
 *   - Descifra bien      → la clave es la correcta. Seguir.
 *   - Descifra con PREV  → hay una rotación en curso. Avisar y re-cifrar.
 *   - No descifra        → LA CLAVE NO CORRESPONDE. Avisar fuerte.
 *
 * En el último caso NO se aborta el arranque: los mensajes entrantes tienen
 * que seguir llegando y guardándose aunque WhatsApp esté caído. Pero queda
 * en el registro con todas las letras, que es lo que faltaba.
 */
import type { Pool } from 'pg'
import type { Logger } from 'pino'
import { isSealed, open, seal, type SealedValue } from './crypto.js'

const TEXTO = 'canario-de-cifrado-v1'

export type ResultadoCanario =
  | { estado: 'creado' }
  | { estado: 'ok' }
  | { estado: 'rotacion' }
  | { estado: 'clave-incorrecta' }

export async function verificarCanario(
  pool: Pool,
  log: Logger,
): Promise<ResultadoCanario> {
  const { rows } = await pool.query('select valor from cifrado_canario where id = 1')

  if (!rows.length) {
    await pool.query(
      'insert into cifrado_canario (id, valor) values (1, $1::jsonb)',
      [JSON.stringify(seal(TEXTO))],
    )
    log.info('Canario de cifrado creado. La clave actual queda registrada.')
    return { estado: 'creado' }
  }

  const guardado = rows[0].valor as unknown
  if (!isSealed(guardado)) {
    log.warn('El canario de cifrado está corrupto. Se regenera.')
    await pool.query(
      'update cifrado_canario set valor = $1::jsonb, rotado_at = now() where id = 1',
      [JSON.stringify(seal(TEXTO))],
    )
    return { estado: 'creado' }
  }

  let abierto: string | null = null
  try {
    abierto = open<string>(guardado as SealedValue)
  } catch {
    abierto = null
  }

  if (abierto !== TEXTO) {
    log.error(
      '\n' +
        '  ══════════════════════════════════════════════════════════════\n' +
        '  LA CLAVE DE CIFRADO NO CORRESPONDE A LOS DATOS GUARDADOS\n' +
        '  ══════════════════════════════════════════════════════════════\n' +
        '  SESSION_ENC_KEY no puede descifrar lo que ya está en la base.\n' +
        '\n' +
        '  Consecuencia: las sesiones de WhatsApp y las claves de API de\n' +
        '  los clientes son ilegibles. Los contactos, conversaciones y\n' +
        '  mensajes NO están afectados: no están cifrados.\n' +
        '\n' +
        '  Si tenés la clave anterior, ponela en SESSION_ENC_KEY_PREV y\n' +
        '  reiniciá: se van a re-cifrar solas sin que nadie escanee nada.\n' +
        '\n' +
        '  Si la perdiste, cada cliente tiene que volver a vincular su\n' +
        '  WhatsApp y a cargar su clave de API desde el panel.\n' +
        '  ══════════════════════════════════════════════════════════════',
    )
    return { estado: 'clave-incorrecta' }
  }

  // Descifró bien. ¿Fue con la clave actual o con la anterior?
  // Si la anterior está definida, re-ciframos con la actual: así la
  // rotación avanza sola y en algún momento se puede quitar PREV.
  if (process.env.SESSION_ENC_KEY_PREV) {
    await pool.query(
      'update cifrado_canario set valor = $1::jsonb, rotado_at = now() where id = 1',
      [JSON.stringify(seal(TEXTO))],
    )
    log.warn(
      'Rotación de clave en curso (SESSION_ENC_KEY_PREV está definida). ' +
        'Las sesiones se re-cifran a medida que se usan. Cuando ya no queden ' +
        'datos con la clave vieja, sacá SESSION_ENC_KEY_PREV del .env.',
    )
    return { estado: 'rotacion' }
  }

  log.info('Clave de cifrado verificada contra los datos guardados.')
  return { estado: 'ok' }
}
