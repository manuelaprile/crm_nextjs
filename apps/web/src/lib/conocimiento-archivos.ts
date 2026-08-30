import 'server-only'

/**
 * Los archivos que acompañan a una entrada de información del negocio.
 *
 * El caso que esto resuelve: cargar "Productos" hoy significa tipear la
 * lista entera en un cuadro de texto. El negocio ya tiene esa lista hecha —es
 * un PDF, o la foto de una carta— y esa diferencia decide si la información
 * se carga o no se carga.
 *
 * EL ARCHIVO NO LLEGA AL ASISTENTE: llega su TEXTO. Se extrae una vez, al
 * subirlo (ver `ai/lector.ts`), y de ahí en adelante el sistema trabaja con
 * texto. Mandar el PDF en cada conversación sería pagar la lista de precios
 * completa en cada mensaje de cada persona.
 *
 * Las mutaciones que dispara la pantalla viven en `conocimiento-acciones.ts`.
 * Acá está lo que se puede llamar desde cualquier lado del servidor,
 * incluida la lectura de fondo que corre fuera del formulario.
 */
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import { leerArchivo, tipoDeArchivo } from './ai/lector'

/**
 * Tope por archivo.
 *
 * Los adjuntos de WhatsApp admiten 25MB porque llegan solos y no hay forma de
 * pedirle a un paciente que mande otra cosa. Acá lo sube el dueño de la
 * cuenta a propósito y puede partir un catálogo en dos, así que el tope es
 * más bajo: son bytes que viajan en cada `pg_dump` y en cada restauración.
 */
export const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024

/**
 * A partir de cuándo una lectura que sigue "leyendo" se considera colgada.
 *
 * La lectura arranca después de responder el formulario. Si el contenedor se
 * reinicia justo ahí, la fila queda en "leyendo" para siempre y nadie
 * entiende por qué el asistente no sabe nada de ese archivo. Pasado este
 * rato, la pantalla ofrece releer.
 */
const LECTURA_TRABADA_MS = 5 * 60 * 1000

export type ArchivoConocimiento = {
  id: string
  nombre: string
  mime: string | null
  tamano: number
  estado: 'leyendo' | 'listo' | 'error'
  texto: string | null
  error: string | null
  /** La lectura arrancó y nunca terminó. Se puede reintentar. */
  trabado: boolean
}

export function mb(n: number): string {
  return n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Los archivos de un conjunto de entradas.
 *
 * Cada id va como su propio parámetro y no como array de JavaScript: Drizzle
 * liga un array como tupla y Postgres contesta "cannot cast type record to
 * uuid[]". Es el mismo tropiezo que ya está documentado en `adjuntosDe`.
 */
export async function archivosDe(
  tenantId: string,
  entryIds: string[],
): Promise<Map<string, ArchivoConocimiento[]>> {
  const salida = new Map<string, ArchivoConocimiento[]>()
  if (!entryIds.length) return salida

  const filas = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select id, entry_id, filename, mime, size_bytes, estado, texto, error,
             updated_at
        from business_knowledge_files
       where tenant_id = ${tenantId}
         and entry_id in (${sql.join(
           entryIds.map((e) => sql`${e}::uuid`),
           sql`, `,
         )})
       order by created_at
    `)
    return res.rows as Record<string, unknown>[]
  })

  const ahora = Date.now()
  for (const f of filas) {
    const entrada = String(f.entry_id)
    const estado = String(f.estado) as ArchivoConocimiento['estado']
    const lista = salida.get(entrada) ?? []
    lista.push({
      id: String(f.id),
      nombre: String(f.filename),
      mime: f.mime ? String(f.mime) : null,
      tamano: Number(f.size_bytes ?? 0),
      estado,
      texto: f.texto ? String(f.texto) : null,
      error: f.error ? String(f.error) : null,
      trabado:
        estado === 'leyendo' &&
        ahora - new Date(String(f.updated_at)).getTime() > LECTURA_TRABADA_MS,
    })
    salida.set(entrada, lista)
  }
  return salida
}

/**
 * Guarda el archivo y arranca la lectura.
 *
 * El orden importa y no es casual: PRIMERO se guardan los bytes, DESPUÉS se
 * lee. Que falle el modelo, que se acabe el saldo o que se caiga la red no
 * puede hacer que se pierda el archivo, que es lo único de todo esto que no
 * se recupera solo. Es la misma decisión que en `guardarAdjunto`.
 *
 * Devuelve el error para mostrar, o null si salió bien.
 */
export async function guardarArchivo(params: {
  tenantId: string
  entryId: string
  userId: string
  file: File
}): Promise<string | null> {
  const { tenantId, entryId, userId, file } = params
  const nombre = file.name.trim().slice(0, 200) || 'archivo'

  if (!file.size) return `«${nombre}» está vacío.`
  if (file.size > MAX_ARCHIVO_BYTES) {
    return `«${nombre}» pesa ${mb(file.size)} y el máximo son ${mb(MAX_ARCHIVO_BYTES)}.`
  }
  if (!tipoDeArchivo(nombre, file.type || null)) {
    return `«${nombre}» no es un tipo que se pueda leer. Se aceptan PDF, imágenes y archivos de texto.`
  }

  const bytes = Buffer.from(await file.arrayBuffer())

  const id = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      insert into business_knowledge_files
        (tenant_id, entry_id, filename, mime, size_bytes, bytes, subido_por)
      values (${tenantId}, ${entryId}, ${nombre}, ${file.type || null},
              ${bytes.byteLength}, ${bytes}, ${userId})
      returning id
    `)
    return String(res.rows[0]!.id)
  })

  // Sin `await`: leer un PDF de cuarenta páginas tarda más de lo que puede
  // esperar un formulario. La pantalla lo muestra como "Leyendo…" y al
  // recargar ya está.
  void leerYGuardar(id, tenantId).catch((err) =>
    console.error('[conocimiento] falló la lectura del archivo', err),
  )

  return null
}

/**
 * Lee un archivo ya guardado y le pega el texto.
 *
 * Se usa recién subido y también desde el botón de releer: el día que el
 * modelo lea mal una lista de precios, hay que poder mandarla de nuevo sin
 * pedirle el archivo otra vez al cliente. Por eso los bytes quedan
 * guardados.
 */
export async function leerYGuardar(
  id: string,
  tenantId: string,
): Promise<void> {
  const fila = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      update business_knowledge_files
         set estado = 'leyendo', error = null
       where id = ${id} and tenant_id = ${tenantId}
      returning filename, mime, bytes
    `)
    return res.rows[0] as
      | { filename: string; mime: string | null; bytes: Buffer | null }
      | undefined
  })

  if (!fila) return
  if (!fila.bytes) {
    await marcarError(id, tenantId, 'El archivo no está guardado.')
    return
  }

  const lectura = await leerArchivo({
    tenantId,
    filename: fila.filename,
    mime: fila.mime,
    bytes: fila.bytes,
  })

  if ('error' in lectura) {
    await marcarError(id, tenantId, lectura.error)
    return
  }

  await withSystem((tx) =>
    tx.execute(sql`
      update business_knowledge_files
         set texto = ${lectura.texto}, estado = 'listo', error = null
       where id = ${id} and tenant_id = ${tenantId}
    `),
  )
}

async function marcarError(
  id: string,
  tenantId: string,
  error: string,
): Promise<void> {
  await withSystem((tx) =>
    tx.execute(sql`
      update business_knowledge_files
         set estado = 'error', error = ${error}
       where id = ${id} and tenant_id = ${tenantId}
    `),
  )
}
