'use server'

/**
 * Cargar y editar lo que el asistente sabe del negocio.
 *
 * Es la pantalla que evita la mayoría de las derivaciones: cada cosa que se
 * carga acá es una pregunta que el asistente deja de pasarle a una persona.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant, withSystem } from './db/client'

const MAX_TITULO = 80
const MAX_CONTENIDO = 4_000

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/configuracion/negocio?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

export async function guardarEntrada(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '').trim()
  const titulo = String(formData.get('titulo') ?? '').trim()
  const contenido = String(formData.get('contenido') ?? '').trim()

  if (!titulo) volver('error', 'Poné un título: es lo que el asistente busca.')
  if (!contenido) volver('error', 'Falta el contenido.')
  if (titulo.length > MAX_TITULO) {
    volver('error', `El título no puede pasar de ${MAX_TITULO} caracteres.`)
  }
  if (contenido.length > MAX_CONTENIDO) {
    volver(
      'error',
      `El contenido no puede pasar de ${MAX_CONTENIDO} caracteres. ` +
        'Si es mucho, partilo en varias entradas: se leen mejor.',
    )
  }

  await withTenant(session, async (tx) => {
    if (id) {
      await tx.execute(sql`
        update business_knowledge
           set titulo = ${titulo}, contenido = ${contenido},
               actualizado_por = ${session.userId}
         where id = ${id}
      `)
      return
    }
    // Al final de la lista. El orden es el que eligió el cliente y una
    // entrada nueva no tiene por qué colarse en el medio.
    const pos = await tx.execute(sql`
      select coalesce(max(posicion), 0) + 1 as p from business_knowledge
    `)
    await tx.execute(sql`
      insert into business_knowledge
        (tenant_id, titulo, contenido, posicion, actualizado_por)
      values (${session.tenantId}, ${titulo}, ${contenido},
              ${Number(pos.rows[0]?.p ?? 1)}, ${session.userId})
    `)
  })

  await withSystem((tx) =>
    tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId},
              ${id ? 'conocimiento.editado' : 'conocimiento.creado'},
              'business_knowledge', ${id || null})
    `),
  )

  revalidatePath('/configuracion/negocio')
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
