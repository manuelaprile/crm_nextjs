import 'server-only'

/**
 * Repartir la consulta según el TEMA.
 *
 * Cada entrada de información del negocio puede tener un encargado. Cuando
 * el asistente identifica sobre qué tema está preguntando la persona, la
 * conversación queda a cargo de quien atiende ese tema, y le aparece en "las
 * mías" sin que nadie la mueva a mano.
 *
 * ======================================================================
 * LO QUE EL MODELO **NO** PUEDE HACER ACÁ
 * ======================================================================
 * Vale repetir el modelo de amenaza de `agent.ts`, porque esta herramienta
 * toca a QUIÉN le llega una conversación y eso se puede intentar usar:
 *
 *  - El modelo elige un TEMA de una lista cerrada, nunca una persona. Quién
 *    atiende cada tema lo decidió un administrador en la pantalla, y esa
 *    traducción pasa acá, en el servidor. No hay forma de escribir un id de
 *    usuario en ningún parámetro.
 *  - Solo temas de SU cuenta y solo los que están activos.
 *  - **No pisa una asignación que ya existe.** Si el hilo ya tiene dueño
 *    —lo tomó una persona, o lo asignó el propio asistente hace tres
 *    mensajes—, se queda como está. Reasignar es un permiso de owner/admin
 *    (regla dura de CLAUDE.md) y no puede sortearse pidiéndole al modelo que
 *    cambie de opinión. Sin esta regla, "en realidad quería preguntar por
 *    otra cosa" repetido tres veces mueve la conversación tres veces.
 *  - Cada asignación deja fila en `conversation_assignments` con
 *    `by_ai = true`, que es exactamente para lo que la 0025 dejó esa
 *    columna, y en `audit_log`.
 */
import { sql } from 'drizzle-orm'
import { withSystem } from './db/client'
import type { ToolSpec } from './ai/provider'

/** Cuántos temas se le ofrecen al modelo. Más que esto no es una lista. */
const MAX_TEMAS = 25

export type TemaConEncargado = { titulo: string; userId: string }

/**
 * Los temas que tienen a alguien atendiéndolos.
 *
 * Si no hay ninguno, no hay herramienta. Es la misma regla que con la
 * agenda: lo que no está, no se ofrece. Un modelo que ve `asignar_tema` en
 * su lista la va a usar aunque no lleve a nadie.
 */
export async function temasConEncargado(
  tenantId: string,
): Promise<TemaConEncargado[]> {
  const filas = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      select k.titulo, k.assigned_user_id
        from business_knowledge k
        join users u on u.id = k.assigned_user_id
       where k.tenant_id = ${tenantId}
         and k.activo
         and u.disabled_at is null
       order by k.posicion, k.created_at
       limit ${MAX_TEMAS}
    `)
    return res.rows as Record<string, unknown>[]
  })
  return filas.map((r) => ({
    titulo: String(r.titulo),
    userId: String(r.assigned_user_id),
  }))
}

export const TOOL_TEMA = 'asignar_tema'

/**
 * La herramienta.
 *
 * El enum son los TÍTULOS y no los identificadores, por dos razones. Los
 * títulos ya están en el prompt —cada uno encabeza su bloque de información
 * del negocio—, así que el modelo no tiene que aprender un mapa nuevo ni se
 * pagan tokens de más. Y en `ai_tool_calls` queda escrito
 * `{"tema": "Productos"}` en vez de un uuid: el registro de lo que hizo la
 * IA existe para que una persona lo lea.
 */
export function toolDeTemas(temas: TemaConEncargado[]): ToolSpec[] {
  if (!temas.length) return []
  return [
    {
      name: TOOL_TEMA,
      description:
        'Decí sobre cuál de estos temas es la consulta. La conversación queda ' +
        'a cargo de la persona del equipo que atiende ese tema, para que le ' +
        'llegue a quien corresponde. Usalo UNA sola vez, apenas quede claro ' +
        'de qué se trata. No corta la conversación ni cambia lo que ' +
        'respondés: seguí atendiendo normalmente.',
      parameters: {
        type: 'object',
        properties: {
          tema: {
            type: 'string',
            enum: temas.map((t) => t.titulo),
            description: 'El tema de la consulta, tal cual figura en la lista.',
          },
        },
        required: ['tema'],
        additionalProperties: false,
      },
    },
  ]
}

/**
 * La instrucción, para el prompt del sistema.
 *
 * NO alcanza con declarar la herramienta. La primera versión solo la
 * ofrecía, y en la prueba con un modelo real el asistente atendió perfecto
 * —contestó los precios que salían del PDF— y no la llamó ni una vez: tenía
 * cuatro herramientas obligatorias en su guion y esta le pareció opcional.
 * Una lista corta de temas dentro del prompt, con la orden explícita, es lo
 * que la vuelve parte de lo que tiene que hacer.
 */
export function instruccionesDeTemas(temas: TemaConEncargado[]): string | null {
  if (!temas.length) return null
  return [
    '# A QUIÉN LE TOCA CADA TEMA',
    '',
    'Estos temas tienen una persona del equipo que los atiende:',
    ...temas.map((t) => `- ${t.titulo}`),
    '',
    'Apenas quede claro que la consulta es sobre alguno de ellos, llamá a ' +
      '`asignar_tema` con ese tema. UNA sola vez, y sin avisarle a la ' +
      'persona: no cambia lo que respondés ni corta la conversación, solo ' +
      'hace que el hilo le llegue a quien corresponde.',
    '',
    'Si la consulta no es sobre ninguno de estos temas, no llames a la ' +
      'herramienta.',
  ].join('\n')
}

/**
 * Deja la conversación a cargo del encargado del tema.
 *
 * Devuelve texto, que es lo que vuelve al modelo como resultado de la
 * herramienta. Nunca lanza: que no se pueda asignar no puede cortar la
 * atención de la persona que está escribiendo.
 */
export async function asignarPorTema(
  ctx: { tenantId: string; conversationId: string; contactId: string | null },
  input: Record<string, unknown>,
): Promise<string> {
  const pedido = String(input.tema ?? '').trim()
  if (!pedido) return 'Falta el tema.'

  const temas = await temasConEncargado(ctx.tenantId)
  // Comparación floja a propósito: el modelo puede devolver el título con
  // otra caja o con un acento de más. El enum ya acotó las opciones; esto
  // solo evita fallar por una tilde.
  const tema = temas.find((t) => igual(t.titulo, pedido))
  if (!tema) return 'Ese tema no tiene a nadie asignado. Seguí atendiendo vos.'

  return withSystem(async (tx) => {
    const actual = await tx.execute(sql`
      select assigned_user_id from conversations
       where id = ${ctx.conversationId} and tenant_id = ${ctx.tenantId}
    `)
    if (!actual.rows.length) return 'Esa conversación no existe.'

    const antes = actual.rows[0]!.assigned_user_id
      ? String(actual.rows[0]!.assigned_user_id)
      : null

    // Ya tiene dueño: no se toca. Ver el modelo de amenaza arriba.
    if (antes) {
      return antes === tema.userId
        ? 'Esta conversación ya está a cargo de quien atiende ese tema.'
        : 'Esta conversación ya tiene un responsable asignado y no se cambia.'
    }

    await tx.execute(sql`
      update conversations set assigned_user_id = ${tema.userId}
       where id = ${ctx.conversationId} and tenant_id = ${ctx.tenantId}
    `)
    await tx.execute(sql`
      insert into conversation_assignments
        (tenant_id, conversation_id, from_user_id, to_user_id, by_ai, reason)
      values (${ctx.tenantId}, ${ctx.conversationId}, null, ${tema.userId},
              true, ${`Consulta sobre «${tema.titulo}»`})
    `)

    /*
     * El contacto sigue a su conversación (regla dura de CLAUDE.md), pero
     * SOLO si todavía no tiene dueño.
     *
     * Cuando deriva una persona manda la última decisión y se pisa lo que
     * hubiera. Acá no: el asistente no le saca un contacto a alguien del
     * equipo porque en un mensaje suelto se habló de otro tema.
     */
    if (ctx.contactId) {
      await tx.execute(sql`
        update contacts set owner_user_id = ${tema.userId}
         where id = ${ctx.contactId} and tenant_id = ${ctx.tenantId}
           and owner_user_id is null
      `)
    }

    await tx.execute(sql`
      insert into audit_log
        (tenant_id, actor_kind, action, entity, entity_id, diff)
      values (${ctx.tenantId}, 'ai', 'conversacion.derivada', 'conversation',
              ${ctx.conversationId},
              ${JSON.stringify({ a: tema.userId, tema: tema.titulo })}::jsonb)
    `)

    return 'Listo, la conversación quedó a cargo de quien atiende ese tema. Seguí atendiendo normalmente.'
  })
}

function igual(a: string, b: string): boolean {
  const n = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
  return n(a) === n(b)
}
