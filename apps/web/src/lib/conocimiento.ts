import 'server-only'
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import { archivosDe, type ArchivoConocimiento } from './conocimiento-archivos'

/**
 * Lo que el asistente sabe además de las instrucciones y el hilo.
 *
 * Dos cosas distintas, que se arman por separado a propósito:
 *
 *  - **El negocio**: precios, horarios, servicios. Igual para todos los
 *    contactos, y es lo que evita derivar por preguntas que se pueden
 *    contestar.
 *  - **El contacto**: quién es, de dónde, en qué etapa está y qué se anotó
 *    sobre él. Distinto en cada conversación, y es lo que evita volver a
 *    preguntar lo que ya contó.
 *
 * Todo va como TEXTO dentro del prompt del sistema, no como mensajes del
 * hilo. Un dato metido como si fuera un mensaje del paciente se confunde con
 * lo que el paciente dijo, y el modelo termina citándolo como si se lo
 * hubieran dicho recién.
 */

/**
 * Tope de caracteres por bloque, para no inflar cada llamada sin control.
 *
 * Eran 8.000 cuando todo se tipeaba a mano. Con archivos adjuntos, un
 * catálogo de productos solo ya se los come. 24.000 son unos 6.000 tokens:
 * en Anthropic el prompt del sistema va con `cache_control`, así que se paga
 * entero la primera vez y a una décima parte en cada turno siguiente. Lo que
 * no entra se corta por entrada completa, nunca a mitad de una.
 */
const TOPE_NEGOCIO = 24_000
const TOPE_NOTAS = 3_000
/** Cuántas notas mira. Las más nuevas primero: son las que describen el hoy. */
const MAX_NOTAS = 15

export type EntradaConocimiento = {
  id: string
  titulo: string
  contenido: string
  activo: boolean
  posicion: number
  actualizadoEn: string
  /** Quién atiende este tema. null = nadie en particular. */
  responsableId: string | null
  responsable: string | null
  archivos: ArchivoConocimiento[]
}

export async function conocimientoDelNegocio(
  tenantId: string,
): Promise<EntradaConocimiento[]> {
  const filas = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select k.id, k.titulo, k.contenido, k.activo, k.posicion, k.updated_at,
             k.assigned_user_id, u.name as responsable
        from business_knowledge k
   left join users u on u.id = k.assigned_user_id
       where k.tenant_id = ${tenantId}
       order by k.posicion, k.created_at
    `)
    return res.rows as Record<string, unknown>[]
  })

  const porEntrada = await archivosDe(
    tenantId,
    filas.map((r) => String(r.id)),
  )

  return filas.map((r) => ({
    id: String(r.id),
    titulo: String(r.titulo),
    contenido: String(r.contenido),
    activo: Boolean(r.activo),
    posicion: Number(r.posicion ?? 0),
    actualizadoEn: String(r.updated_at),
    responsableId: r.assigned_user_id ? String(r.assigned_user_id) : null,
    responsable: r.responsable ? String(r.responsable) : null,
    archivos: porEntrada.get(String(r.id)) ?? [],
  }))
}

/**
 * El bloque de negocio, listo para pegar en el prompt.
 *
 * Devuelve null si no hay nada cargado: sin conocimiento es mejor no decir
 * nada que abrir una sección vacía, que el modelo lee como "no tengo
 * información" y a veces la completa por su cuenta.
 */
export async function bloqueNegocio(tenantId: string): Promise<string | null> {
  const entradas = (await conocimientoDelNegocio(tenantId)).filter((e) => e.activo)
  if (!entradas.length) return null

  let texto = ''
  for (const e of entradas) {
    /*
     * Lo que se leyó de los archivos va DENTRO de la entrada, debajo de lo
     * que escribió el dueño, y con el nombre del archivo adelante.
     *
     * Lo primero, porque una lista de precios sin su título ("Productos") es
     * una lista de números sueltos. Lo segundo, porque si el asistente
     * después dice algo raro, el nombre del archivo es lo que permite ir a
     * mirar de dónde lo sacó.
     *
     * Solo los que se leyeron bien: un archivo en error no aporta nada, y
     * uno a medio leer aportaría una lista incompleta, que es peor que
     * ninguna —el asistente diría que un producto no existe—.
     */
    const deArchivos = e.archivos
      .filter((a) => a.estado === 'listo' && a.texto)
      .map((a) => `\nDel archivo «${a.nombre}»:\n${a.texto!.trim()}\n`)
      .join('')

    const trozo = `## ${e.titulo}\n${e.contenido.trim()}\n${deArchivos}\n`
    if (texto.length + trozo.length > TOPE_NEGOCIO) break
    texto += trozo
  }

  return (
    '# INFORMACIÓN DEL NEGOCIO\n\n' +
    'Esto es lo que sabés con certeza y podés responder sin consultar con ' +
    'nadie.\n\n' +
    texto.trimEnd() +
    '\n\nSi te preguntan algo que NO está acá arriba, no lo inventes ni lo ' +
    'deduzcas: decí que lo consultás y derivá. Un precio o un horario ' +
    'inventado es un compromiso que alguien va a tener que sostener.'
  )
}

/**
 * Lo que sabemos de esta persona.
 *
 * Se arma con datos que YA existen en la ficha y en las notas. Nada nuevo se
 * guarda: lo único que cambia es que el asistente por fin los mira.
 */
export async function bloqueContacto(
  contactId: string | null,
  zona = 'America/Argentina/Buenos_Aires',
): Promise<string | null> {
  if (!contactId) return null

  return withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select c.display_name, c.phone, c.email, c.city, c.province,
             c.created_at, s.name as etapa
        from contacts c
        left join stages s on s.id = c.stage_id
       where c.id = ${contactId}
    `)
    const c = res.rows[0] as Record<string, unknown> | undefined
    if (!c) return null

    const datos: string[] = []
    if (c.display_name) datos.push(`- Nombre: ${c.display_name}`)
    if (c.city || c.province) {
      datos.push(`- De: ${[c.city, c.province].filter(Boolean).join(', ')}`)
    }
    if (c.email) datos.push(`- Correo: ${c.email}`)
    if (c.etapa) datos.push(`- Estado actual: ${c.etapa}`)

    // Campos propios del rubro, si el cliente definió alguno.
    // `value` es jsonb. `#>> '{}'` saca el texto de un escalar sin las
    // comillas que traería `::text`, y devuelve null para un objeto o un
    // array — que no tendría sentido pegar crudo en un prompt.
    const cf = await tx.execute(sql`
      select d.label, v.value #>> '{}' as texto
        from custom_field_values v
        join custom_field_defs d on d.id = v.field_id
       where v.contact_id = ${contactId}
         and coalesce(v.value #>> '{}', '') <> ''
       order by d.position
    `)
    for (const f of cf.rows as { label: string; texto: string }[]) {
      datos.push(`- ${f.label}: ${f.texto}`)
    }

    /**
     * Las notas, de la más nueva a la más vieja.
     *
     * Se leen tanto las del asistente como las de las personas: es lo que le
     * da memoria de verdad entre conversaciones. Las marcadas como privadas
     * quedan afuera — ahí es donde el equipo escribe lo que se dice entre sí.
     */
    const notas = await tx.execute(sql`
      select body, by_ai, created_at from notes
       where contact_id = ${contactId} and visible_ia
       order by created_at desc
       limit ${MAX_NOTAS}
    `)

    let textoNotas = ''
    for (const n of notas.rows as {
      body: string
      by_ai: boolean
      created_at: string
    }[]) {
      // Con la zona del negocio: una nota de anoche a las 22 no puede
      // aparecerle al asistente fechada al día siguiente.
      const fecha = new Date(n.created_at).toLocaleDateString('es-AR', {
        timeZone: zona,
      })
      const linea = `- (${fecha}) ${n.body.trim()}\n`
      if (textoNotas.length + linea.length > TOPE_NOTAS) break
      textoNotas += linea
    }

    if (!datos.length && !textoNotas) return null

    let bloque = '# LO QUE YA SABÉS DE ESTA PERSONA\n\n'
    if (datos.length) bloque += `${datos.join('\n')}\n`
    if (textoNotas) {
      bloque +=
        '\nAnotaciones previas, de la más reciente a la más vieja:\n' +
        textoNotas
    }
    bloque +=
      '\nUsá esto para no volver a preguntar lo que ya contó. Son notas ' +
      'INTERNAS del equipo: no las leas en voz alta ni las menciones como ' +
      'si te las hubiera dicho recién. Si algo de acá está viejo o se ' +
      'contradice con lo que dice ahora, mandá lo que dice ahora.'

    return bloque
  })
}

/**
 * El prompt completo que recibe el asistente.
 *
 * El orden importa: primero quién es y cómo trabaja (las instrucciones que
 * cargó el cliente), después qué sabe del negocio, y al final a quién le está
 * hablando. Lo más específico va último, que es lo que el modelo tiende a
 * pesar más.
 */
export async function promptCompleto(params: {
  base: string
  tenantId: string
  contactId: string | null
  /** La zona del negocio, para fechar las notas como las leería una persona. */
  zona?: string
}): Promise<string> {
  const [negocio, contacto] = await Promise.all([
    bloqueNegocio(params.tenantId),
    bloqueContacto(params.contactId, params.zona),
  ])
  return [params.base, negocio, contacto].filter(Boolean).join('\n\n---\n\n')
}
