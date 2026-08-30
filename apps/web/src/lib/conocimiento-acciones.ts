'use server'

/**
 * Cargar y editar lo que el asistente sabe del negocio.
 *
 * Es la pantalla que evita la mayoría de las derivaciones: cada cosa que se
 * carga acá es una pregunta que el asistente deja de pasarle a una persona.
 *
 * Cada entrada tiene además dos cosas que no son texto:
 *  - ARCHIVOS, porque el negocio ya tiene la lista de precios hecha y
 *    tipearla de nuevo es lo que hace que no se cargue nunca.
 *  - UN ENCARGADO, para que la consulta sobre ese tema le llegue a quien lo
 *    atiende en vez de al montón.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant, withSystem, type TenantContext } from './db/client'
import { guardarArchivo, leerYGuardar } from './conocimiento-archivos'

const MAX_TITULO = 80
const MAX_CONTENIDO = 4_000
/** Cuántos archivos entran de una vez. Más que esto es una carpeta, no un tema. */
const MAX_ARCHIVOS = 5

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/configuracion/negocio?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

/**
 * El encargado tiene que ser de ESTA cuenta y tiene que poder entrar.
 *
 * Sin esto, un id pegado en el formulario deja un tema a cargo de alguien que
 * no puede verlo, y las consultas sobre ese tema caen en una bandeja que
 * nadie mira. Es el mismo chequeo que hace `derivarConversacion`.
 */
async function encargadoValido(
  session: TenantContext,
  userId: string,
): Promise<boolean> {
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select 1
        from tenant_users tu
        join users u on u.id = tu.user_id
       where tu.user_id = ${userId}
         and u.is_superadmin = false
         and u.disabled_at is null
    `)
    return res.rows.length > 0
  })
}

export async function guardarEntrada(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '').trim()
  const titulo = String(formData.get('titulo') ?? '').trim()
  const contenido = String(formData.get('contenido') ?? '').trim()
  const responsable = String(formData.get('responsable') ?? '').trim() || null

  if (!titulo) volver('error', 'Poné un título: es lo que el asistente busca.')
  if (!contenido) volver('error', 'Falta el contenido.')
  if (titulo.length > MAX_TITULO) {
    volver('error', `El título no puede pasar de ${MAX_TITULO} caracteres.`)
  }
  if (contenido.length > MAX_CONTENIDO) {
    volver(
      'error',
      `El contenido no puede pasar de ${MAX_CONTENIDO} caracteres. ` +
        'Si es mucho, partilo en varias entradas: se leen mejor. Si ya lo ' +
        'tenés en un PDF, adjuntalo.',
    )
  }
  if (responsable && !(await encargadoValido(session, responsable))) {
    volver('error', 'Esa persona no es de esta cuenta o está deshabilitada.')
  }

  const entryId = await withTenant(session, async (tx) => {
    if (id) {
      await tx.execute(sql`
        update business_knowledge
           set titulo = ${titulo}, contenido = ${contenido},
               assigned_user_id = ${responsable},
               actualizado_por = ${session.userId}
         where id = ${id}
      `)
      return id
    }
    // Al final de la lista. El orden es el que eligió el cliente y una
    // entrada nueva no tiene por qué colarse en el medio.
    const pos = await tx.execute(sql`
      select coalesce(max(posicion), 0) + 1 as p from business_knowledge
    `)
    const res = await tx.execute(sql`
      insert into business_knowledge
        (tenant_id, titulo, contenido, posicion, assigned_user_id, actualizado_por)
      values (${session.tenantId}, ${titulo}, ${contenido},
              ${Number(pos.rows[0]?.p ?? 1)}, ${responsable}, ${session.userId})
      returning id
    `)
    return String(res.rows[0]!.id)
  })

  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId},
              ${id ? 'conocimiento.editado' : 'conocimiento.creado'},
              'business_knowledge', ${entryId})
    `),
  )

  /*
   * Los archivos van DESPUÉS de guardar la entrada, y sus errores no la
   * deshacen.
   *
   * Si uno de tres archivos no se puede leer, lo que se cargó a mano ya está
   * guardado y lo que sí entró también. Perder las tres cosas por una sería
   * hacerle escribir todo de nuevo por un PDF corrupto.
   */
  const archivos = formData
    .getAll('archivos')
    .filter((a): a is File => a instanceof File && a.size > 0)
    .slice(0, MAX_ARCHIVOS)

  const fallaron: string[] = []
  for (const file of archivos) {
    const error = await guardarArchivo({
      tenantId: session.tenantId,
      entryId,
      userId: session.userId,
      file,
    })
    if (error) fallaron.push(error)
  }

  revalidatePath('/configuracion/negocio')

  if (fallaron.length) volver('error', fallaron.join(' '))
  if (archivos.length) {
    // La lectura corre fuera del formulario, así que la pantalla vuelve
    // antes de que termine. Sin decirlo, el archivo aparece como "Leyendo…"
    // y parece que quedó colgado.
    volver(
      'ok',
      archivos.length === 1
        ? 'Guardado. Se está leyendo el archivo: recargá en un momento.'
        : `Guardado. Se están leyendo ${archivos.length} archivos: recargá en un momento.`,
    )
  }
  volver('ok', id ? 'Guardado.' : `Se agregó «${titulo}».`)
}

/** Prender o apagar una entrada sin borrarla. */
export async function alternarEntrada(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  await withTenant(session, (tx) =>
    tx.execute(sql`
      update business_knowledge set activo = not activo where id = ${id}
    `),
  )
  revalidatePath('/configuracion/negocio')
  redirect('/configuracion/negocio')
}

export async function borrarEntrada(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '').trim()
  const titulo = String(formData.get('titulo') ?? '').trim()
  if (!id) return

  // Los archivos se van con la entrada por el `on delete cascade`. Es lo que
  // corresponde: son parte de ella, no material suelto de la cuenta.
  await withTenant(session, (tx) =>
    tx.execute(sql`delete from business_knowledge where id = ${id}`),
  )
  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, diff)
      values (${session.tenantId}, ${session.userId}, 'conocimiento.borrado',
              'business_knowledge', ${JSON.stringify({ titulo })}::jsonb)
    `),
  )
  revalidatePath('/configuracion/negocio')
  volver('ok', `Se borró «${titulo}».`)
}

// ---------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------

export async function borrarArchivo(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('archivoId') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!id) return

  await withTenant(session, (tx) =>
    tx.execute(sql`delete from business_knowledge_files where id = ${id}`),
  )
  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, diff)
      values (${session.tenantId}, ${session.userId},
              'conocimiento.archivo.borrado', 'business_knowledge_files',
              ${JSON.stringify({ nombre })}::jsonb)
    `),
  )
  revalidatePath('/configuracion/negocio')
  volver('ok', `Se borró «${nombre}».`)
}

/**
 * Volver a leer un archivo que ya está guardado.
 *
 * Para eso se guardan los bytes y no solo el texto: si el modelo leyó mal
 * una lista de precios, o la lectura quedó colgada por un reinicio, se
 * reintenta sin pedirle el archivo de nuevo al cliente.
 */
export async function releerArchivo(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('archivoId') ?? '').trim()
  if (!id) return

  // El archivo tiene que ser de esta cuenta. La consulta pasa por RLS, así
  // que con un id de otra cuenta simplemente no hay fila.
  const existe = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select 1 from business_knowledge_files where id = ${id}
    `)
    return res.rows.length > 0
  })
  if (!existe) volver('error', 'Ese archivo no existe.')

  void leerYGuardar(id, session.tenantId).catch((err) =>
    console.error('[conocimiento] falló releer el archivo', err),
  )

  revalidatePath('/configuracion/negocio')
  volver('ok', 'Se está leyendo de nuevo. Recargá en un momento.')
}
