/**
 * Auth state de Baileys persistido en Postgres.
 *
 * Baileys trae `useMultiFileAuthState`, que guarda la sesión en archivos sueltos.
 * No nos sirve: el worker corre en un contenedor que se recrea en cada deploy, y
 * perder la carpeta significa que TODOS los clientes tienen que volver a escanear
 * el QR. Con la sesión en Postgres, el contenedor es descartable.
 *
 * Dos trampas que hay que respetar:
 *
 * 1. Las credenciales contienen Buffers y Uint8Array. `JSON.stringify` los
 *    destruye en silencio (quedan como {"0":12,"1":45,...} y la sesión no
 *    levanta más). Por eso va SIEMPRE con BufferJSON.replacer / .reviver.
 *
 * 2. Los valores de tipo `app-state-sync-key` tienen que volver a hidratarse con
 *    `proto.Message.AppStateSyncKeyData.fromObject`, si no Baileys no puede
 *    desencriptar el estado de la app y no llegan los mensajes históricos.
 */
import type { Pool } from 'pg'
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys'
import { isSealed, open, seal } from './crypto.js'

const CREDS_KEY = 'creds'

export type PgAuthState = {
  state: AuthenticationState
  /** Persiste las credenciales. Se llama en cada evento `creds.update`. */
  saveCreds: () => Promise<void>
  /** Borra toda la sesión. Solo en logout: obliga a re-escanear. */
  clear: () => Promise<void>
}

/**
 * Serializa con BufferJSON (para no destruir los Buffers) y después cifra.
 * Lo que llega a Postgres es un sobre {v,iv,tag,ct}: nada legible.
 */
function serialize(value: unknown): string {
  const encoded = JSON.stringify(value, BufferJSON.replacer)
  return JSON.stringify(seal(encoded))
}

function deserialize<T>(raw: unknown): T {
  if (!isSealed(raw)) {
    // Fila anterior al cifrado. Se lee igual y se re-cifra en la próxima
    // escritura, así una base existente migra sola sin re-escanear los QR.
    return JSON.parse(JSON.stringify(raw), BufferJSON.reviver) as T
  }
  const encoded = open<string>(raw)
  return JSON.parse(encoded, BufferJSON.reviver) as T
}

export async function usePostgresAuthState(
  pool: Pool,
  accountId: string,
): Promise<PgAuthState> {
  async function read<T>(keyId: string): Promise<T | undefined> {
    const { rows } = await pool.query(
      'select value from wa_session_keys where account_id = $1 and key_id = $2',
      [accountId, keyId],
    )
    if (!rows.length) return undefined
    try {
      return deserialize<T>(rows[0].value)
    } catch {
      // Una fila corrupta no puede voltear la sesión entera: la tratamos como
      // ausente y Baileys la vuelve a negociar.
      return undefined
    }
  }

  async function write(keyId: string, value: unknown): Promise<void> {
    await pool.query(
      `insert into wa_session_keys (account_id, key_id, value, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (account_id, key_id)
       do update set value = excluded.value, updated_at = now()`,
      [accountId, keyId, serialize(value)],
    )
  }

  async function remove(keyIds: string[]): Promise<void> {
    if (!keyIds.length) return
    await pool.query(
      'delete from wa_session_keys where account_id = $1 and key_id = any($2::text[])',
      [accountId, keyIds],
    )
  }

  const creds: AuthenticationCreds =
    (await read<AuthenticationCreds>(CREDS_KEY)) ?? initAuthCreds()

  const state: AuthenticationState = {
    creds,
    keys: {
      async get(type, ids) {
        const out: { [id: string]: SignalDataTypeMap[typeof type] } = {}
        // Una sola consulta para todos los ids: `get` se llama en el camino
        // caliente de cada mensaje y un round-trip por id se nota.
        const keyIds = ids.map((id) => `${type}-${id}`)
        const { rows } = await pool.query(
          'select key_id, value from wa_session_keys where account_id = $1 and key_id = any($2::text[])',
          [accountId, keyIds],
        )
        for (const row of rows) {
          const id = String(row.key_id).slice(type.length + 1)
          let value = deserialize<unknown>(row.value)
          if (type === 'app-state-sync-key' && value) {
            // Trampa 2: sin esto el estado de la app no desencripta.
            value = proto.Message.AppStateSyncKeyData.fromObject(
              value as Record<string, unknown>,
            )
          }
          out[id] = value as SignalDataTypeMap[typeof type]
        }
        return out
      },

      async set(data) {
        const writes: Promise<void>[] = []
        const deletes: string[] = []
        for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const entries = data[type]
          if (!entries) continue
          for (const [id, value] of Object.entries(entries)) {
            const keyId = `${type}-${id}`
            if (value === null || value === undefined) deletes.push(keyId)
            else writes.push(write(keyId, value))
          }
        }
        await Promise.all([...writes, remove(deletes)])
      },
    },
  }

  return {
    state,
    saveCreds: () => write(CREDS_KEY, state.creds),
    clear: async () => {
      await pool.query('delete from wa_session_keys where account_id = $1', [accountId])
    },
  }
}
