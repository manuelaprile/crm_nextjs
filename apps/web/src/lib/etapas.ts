'use server'

/**
 * Etapas del embudo, editables por el cliente.
 *
 * Es la pieza que hace que el mismo sistema sirva para un consultorio y para
 * una inmobiliaria: "Consulta inicial → Interesado → Visitó el consultorio →
 * Se operó" y "Consulta nueva → Contactado → Visita agendada → Cerró la
 * operación" son la misma tabla. Ver la regla del pipeline en CLAUDE.md.
 *
 * Lo que NO se toca desde acá: la `key`. Es el identificador estable que usan
 * el agente de IA y los reportes. El cliente cambia el nombre visible; la
 * clave sigue siendo la misma para que el historial no se rompa.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant } from './db/client'

export type EtapaConfig = {
  id: string
  key: string
  name: string
  color: string
  position: number
  esInicial: boolean
  esGanada: boolean
  esPerdida: boolean
  /** Contactos parados hoy en esta etapa. */
  contactos: number
  /** Veces que un contacto llegó a esta etapa, alguna vez. */
  historial: number
}

export async function listarEtapas(): Promise<EtapaConfig[]> {
  const session = await requireAdmin()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select s.id, s.key, s.name, s.color, s.position,
             s.is_initial, s.is_won, s.is_lost,
             (select count(*)::int from contacts c
               where c.stage_id = s.id and c.archived_at is null) as contactos,
             (select count(*)::int from stage_history h
               where h.to_stage_id = s.id) as historial
        from stages s
       order by s.position
    `)
    return (res.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      key: String(r.key),
      name: String(r.name),
      color: String(r.color),
      position: Number(r.position),
      esInicial: Boolean(r.is_initial),
      esGanada: Boolean(r.is_won),
      esPerdida: Boolean(r.is_lost),
      contactos: Number(r.contactos),
      historial: Number(r.historial),
    }))
  })
}

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/configuracion/etapas?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

function listo() {
  revalidatePath('/configuracion/etapas')
  revalidatePath('/contactos')
  revalidatePath('/reportes')
}

/** "Visitó el consultorio" -> "visito-el-consultorio" */
function clave(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

const COLOR_OK = /^#[0-9a-fA-F]{6}$/

export async function crearEtapa(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 60)
  const color = String(formData.get('color') ?? '#6B7280')

  if (!nombre) volver('error', 'Ponele un nombre a la etapa.')
  if (!COLOR_OK.test(color)) volver('error', 'El color no es válido.')

  const base = clave(nombre)
  if (!base) volver('error', 'El nombre tiene que tener alguna letra o número.')

  await withTenant(session, async (tx) => {
    // La clave tiene que ser única dentro del tenant. Si ya existe una etapa
    // que se llamaba igual (aunque después la hayan renombrado), se numera.
    const usadas = await tx.execute(sql`
      select key from stages where key like ${base + '%'}
    `)
    const tomadas = new Set(
      (usadas.rows as { key: string }[]).map((r) => r.key),
    )
    let k = base
    for (let i = 2; tomadas.has(k); i++) k = `${base}-${i}`

    const pos = await tx.execute(
      sql`select coalesce(max(position), -1) + 1 as p from stages`,
    )

    await tx.execute(sql`
      insert into stages (tenant_id, key, name, color, position)
      values (${session.tenantId}, ${k}, ${nombre}, ${color},
              ${Number((pos.rows[0] as { p: number }).p)})
    `)
  })

  listo()
  volver('ok', `Etapa «${nombre}» creada.`)
}

export async function renombrarEtapa(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 60)
  const color = String(formData.get('color') ?? '#6B7280')

  if (!id) return
  if (!nombre) volver('error', 'El nombre no puede quedar vacío.')
  if (!COLOR_OK.test(color)) volver('error', 'El color no es válido.')

  await withTenant(session, (tx) =>
    tx.execute(sql`
      update stages set name = ${nombre}, color = ${color} where id = ${id}
    `),
  )
  listo()
  volver('ok', 'Etapa actualizada.')
}

/**
 * Marca qué papel cumple la etapa dentro del embudo.
 *
 * `inicial` y `ganada` son de a una: la primera porque hay un índice único que
 * lo exige (los contactos nuevos tienen que caer en un solo lugar), la segunda
 * porque los reportes preguntan "cuántos llegaron a la etapa ganadora" y con
 * dos la respuesta sería ambigua. `perdida` puede repetirse: un negocio puede
 * distinguir "no le interesó" de "fuera de zona".
 */
export async function marcarEtapa(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  if (!id || !['normal', 'inicial', 'ganada', 'perdida'].includes(tipo)) return

  await withTenant(session, async (tx) => {
    if (tipo === 'inicial') {
      // Primero se apaga la que estaba: el índice único no admite dos, ni
      // siquiera por un instante dentro de la misma transacción.
      await tx.execute(sql`update stages set is_initial = false where is_initial`)
      await tx.execute(sql`
        update stages set is_initial = true, is_won = false, is_lost = false
         where id = ${id}
      `)
    } else if (tipo === 'ganada') {
      await tx.execute(sql`update stages set is_won = false where is_won`)
      await tx.execute(sql`
        update stages set is_won = true, is_lost = false, is_initial = false
         where id = ${id}
      `)
    } else if (tipo === 'perdida') {
      await tx.execute(sql`
        update stages set is_lost = true, is_won = false, is_initial = false
         where id = ${id}
      `)
    } else {
      await tx.execute(sql`
        update stages set is_won = false, is_lost = false, is_initial = false
         where id = ${id}
      `)
    }

    // No puede quedar el embudo sin etapa inicial: los contactos nuevos no
    // tendrían dónde caer.
    const quedan = await tx.execute(
      sql`select count(*)::int as n from stages where is_initial`,
    )
    if (Number((quedan.rows[0] as { n: number }).n) === 0) {
      await tx.execute(sql`
        update stages set is_initial = true
         where id = (select id from stages
                      where not is_lost and not is_won
                      order by position limit 1)
      `)
    }
  })

  listo()
  volver('ok', 'Listo.')
}

export async function moverEtapa(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const hacia = String(formData.get('hacia') ?? '')
  if (!id || !['arriba', 'abajo'].includes(hacia)) return

  await withTenant(session, async (tx) => {
    const actual = await tx.execute(
      sql`select position from stages where id = ${id}`,
    )
    const row = actual.rows[0] as { position: number } | undefined
    if (!row) return
    const pos = Number(row.position)

    // La vecina en esa dirección. Si no hay, ya está en la punta.
    const vecina = await tx.execute(
      hacia === 'arriba'
        ? sql`select id, position from stages where position < ${pos}
               order by position desc limit 1`
        : sql`select id, position from stages where position > ${pos}
               order by position asc limit 1`,
    )
    const v = vecina.rows[0] as { id: string; position: number } | undefined
    if (!v) return

    // Intercambio en dos pasos con un valor imposible en el medio: `position`
    // no es único, pero dejarlas iguales aunque sea un instante haría que el
    // orden dependa de la suerte.
    await tx.execute(sql`update stages set position = -1 where id = ${id}`)
    await tx.execute(sql`update stages set position = ${pos} where id = ${v.id}`)
    await tx.execute(
      sql`update stages set position = ${Number(v.position)} where id = ${id}`,
    )
  })

  listo()
  redirect('/configuracion/etapas')
}

export async function borrarEtapa(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const problema = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select s.name, s.is_initial,
             (select count(*)::int from stages) as total,
             (select count(*)::int from contacts c where c.stage_id = s.id) as contactos,
             (select count(*)::int from stage_history h where h.to_stage_id = s.id) as historial
        from stages s where s.id = ${id}
    `)
    const r = res.rows[0] as Record<string, unknown> | undefined
    if (!r) return 'Esa etapa ya no existe.'
    if (Number(r.total) <= 2) return 'Un embudo necesita al menos dos etapas.'
    if (r.is_initial) {
      return 'Es la etapa inicial. Marcá otra como inicial y volvé a intentar.'
    }
    if (Number(r.contactos) > 0) {
      return `«${r.name}» tiene ${r.contactos} contacto(s). Movelos a otra etapa antes de borrarla.`
    }
    // Borrar la etapa se lleva por delante las filas de `stage_history` que
    // apuntan a ella (on delete cascade), y con eso el embudo acumulado
    // quedaría mal para siempre. Una etapa usada se renombra, no se borra.
    if (Number(r.historial) > 0) {
      return `Por «${r.name}» ya pasaron contactos, así que borrarla rompería el reporte de embudo. Renombrala en vez de borrarla.`
    }
    await tx.execute(sql`delete from stages where id = ${id}`)
    return null
  })

  listo()
  if (problema) volver('error', problema)
  volver('ok', 'Etapa borrada.')
}
