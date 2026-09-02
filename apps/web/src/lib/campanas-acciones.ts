'use server'

/**
 * Guardar y borrar campañas.
 *
 * Las mutaciones viven acá y las lecturas en `campanas.ts`, como en el resto
 * del proyecto. Y todo entra por `puertaDelModulo()`: una acción de servidor
 * se puede invocar sin pasar por la pantalla, así que el módulo se verifica
 * en cada camino y no solo en el que dibuja el menú.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { withTenant } from './db/client'
import {
  puertaDelModulo,
  contarAlcance,
  buscarElegibles,
  leerFiltros,
  MAX_MENSAJE,
  MAX_IMAGEN_BYTES,
  type ContactoElegible,
  type Destino,
} from './campanas'

function volver(destino: string, tipo: 'ok' | 'error', msg: string): never {
  redirect(`${destino}?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`)
}

const DESTINOS: Destino[] = ['todos', 'filtros', 'manual']

/** Los uuid que vinieron del formulario, sin confiar en el texto. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function uuids(formData: FormData, campo: string): string[] {
  return formData
    .getAll(campo)
    .map((v) => String(v))
    .filter((v) => UUID.test(v))
}

/**
 * Guardar el borrador. Crea si no vino id, actualiza si vino.
 *
 * La imagen se guarda SOLO si mandaron una nueva. Un formulario de archivo
 * vacío es lo normal al reeditar el texto de una campaña que ya tiene
 * imagen, y tratarlo como "borrala" haría que corregir una coma le vuele la
 * foto a alguien.
 */
export async function guardarCampana(formData: FormData): Promise<void> {
  const session = await puertaDelModulo()

  const id = String(formData.get('id') ?? '').trim()
  const vuelvoA = id ? `/campanas/${id}` : '/campanas/nueva'

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!nombre) volver(vuelvoA, 'error', 'Poné un nombre para la campaña.')
  if (nombre.length > 80) volver(vuelvoA, 'error', 'El nombre es muy largo.')

  const destinoCrudo = String(formData.get('destino') ?? 'todos')
  const destino = (DESTINOS as string[]).includes(destinoCrudo)
    ? (destinoCrudo as Destino)
    : 'todos'

  const mensaje = String(formData.get('mensaje') ?? '')
  if (mensaje.length > MAX_MENSAJE) {
    volver(vuelvoA, 'error', `El mensaje pasa los ${MAX_MENSAJE} caracteres.`)
  }

  const filtros = {
    etapas: uuids(formData, 'etapas'),
    etiquetas: uuids(formData, 'etiquetas'),
  }
  const elegidos = uuids(formData, 'elegidos')

  // La plantilla y sus valores. El nombre se valida contra lo que Meta
  // permite; el texto NO se guarda —vive en Meta— y los valores van en orden.
  const plantilla = String(formData.get('plantilla') ?? '').trim() || null
  if (plantilla && !/^[a-z0-9_]{1,60}$/.test(plantilla)) {
    volver(vuelvoA, 'error', 'Esa plantilla no existe.')
  }
  const plantillaIdioma = String(formData.get('plantillaIdioma') ?? '').trim() || null
  const params = formData
    .getAll('param')
    .map((v) => String(v).slice(0, 300))

  if (destino === 'manual' && elegidos.length === 0) {
    volver(vuelvoA, 'error', 'Elegiste "a mano" pero no marcaste a nadie.')
  }

  // ---- La imagen -------------------------------------------------
  const archivo = formData.get('imagen')
  let bytes: Buffer | null = null
  let mime: string | null = null
  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > MAX_IMAGEN_BYTES) {
      volver(vuelvoA, 'error', 'La imagen no puede pasar de 5 MB.')
    }
    // Lista blanca, no lista negra: el día que alguien suba un SVG con un
    // script adentro, "todo menos X" ya lo dejó pasar.
    if (!['image/jpeg', 'image/png'].includes(archivo.type)) {
      volver(vuelvoA, 'error', 'La imagen tiene que ser JPG o PNG.')
    }
    bytes = Buffer.from(await archivo.arrayBuffer())
    mime = archivo.type
  }
  const sacarImagen = String(formData.get('sacarImagen') ?? '') === 'si'

  const nuevoId = await withTenant(session, async (tx) => {
    let campanaId = id
    if (campanaId) {
      await tx.execute(sql`
        update campanas
           set nombre = ${nombre},
               destino = ${destino},
               filtros = ${JSON.stringify(filtros)}::jsonb,
               mensaje = ${mensaje},
               plantilla = ${plantilla},
               plantilla_idioma = ${plantillaIdioma},
               plantilla_params = ${JSON.stringify(params)}::jsonb,
               imagen = case
                          when ${bytes !== null} then ${bytes}::bytea
                          when ${sacarImagen} then null
                          else imagen end,
               imagen_mime = case
                          when ${bytes !== null} then ${mime}
                          when ${sacarImagen} then null
                          else imagen_mime end
         where id = ${campanaId}::uuid
      `)
    } else {
      const res = await tx.execute(sql`
        insert into campanas (tenant_id, nombre, destino, filtros, mensaje,
                              plantilla, plantilla_idioma, plantilla_params,
                              imagen, imagen_mime, creada_por)
        values (${session.tenantId}, ${nombre}, ${destino},
                ${JSON.stringify(filtros)}::jsonb, ${mensaje},
                ${plantilla}, ${plantillaIdioma},
                ${JSON.stringify(params)}::jsonb,
                ${bytes}::bytea, ${mime}, ${session.userId})
        returning id
      `)
      campanaId = String((res.rows[0] as { id: string }).id)
    }

    // Los elegidos a mano se reescriben enteros: es una lista, no un
    // historial, y calcular el diff para ahorrar dos DELETE sería complicar
    // algo que nadie va a mirar.
    await tx.execute(
      sql`delete from campana_contactos where campana_id = ${campanaId}::uuid`,
    )
    if (destino === 'manual' && elegidos.length) {
      await tx.execute(sql`
        insert into campana_contactos (campana_id, contact_id, tenant_id)
        select ${campanaId}::uuid, c.id, c.tenant_id
          from contacts c
         -- Va por sql.param y no por la lista a secas: drizzle pega los
         -- arrays como fragmentos de SQL en vez de mandarlos como valor.
         -- El motivo largo está en contarAlcance.
         where c.id = any(${sql.param(elegidos)}::uuid[])
      `)
    }
    return campanaId
  })

  revalidatePath('/campanas')
  volver(`/campanas/${nuevoId}`, 'ok', `«${nombre}» quedó guardada.`)
}

export async function borrarCampana(formData: FormData): Promise<void> {
  const session = await puertaDelModulo()
  const id = String(formData.get('id') ?? '').trim()
  if (!UUID.test(id)) volver('/campanas', 'error', 'Campaña inválida.')

  await withTenant(session, (tx) =>
    tx.execute(sql`delete from campanas where id = ${id}::uuid`),
  )
  revalidatePath('/campanas')
  volver('/campanas', 'ok', 'Campaña borrada.')
}

// ---------------------------------------------------------------------
// Lo que el compositor le pregunta al servidor mientras lo usan
// ---------------------------------------------------------------------

/** Cuántos contactos alcanzan estos filtros. Para el contador en vivo. */
export async function alcanceDe(
  destino: Destino,
  filtros: unknown,
  elegidos: string[],
): Promise<number> {
  return contarAlcance(destino, leerFiltros(filtros), elegidos)
}

/** Buscador de contactos para la selección a mano. */
export async function elegiblesPara(
  texto: string,
  pagina: number,
): Promise<{ filas: ContactoElegible[]; total: number; paginas: number }> {
  return buscarElegibles(String(texto ?? '').slice(0, 80), Number(pagina) || 1)
}
