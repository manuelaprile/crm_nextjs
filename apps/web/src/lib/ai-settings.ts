'use server'

/**
 * Configuración del asistente.
 *
 * Las acciones REDIRIGEN con el resultado en la query en vez de devolverlo
 * por `useActionState`. Es a propósito: así el formulario funciona **aunque
 * el JavaScript del cliente no cargue**. `useActionState` solo responde
 * después de hidratar; si algo rompe el JS —una CSP mal puesta, un error de
 * red, una extensión del navegador— el botón deja de hacer nada y no hay
 * ningún error visible. Ya pasó una vez y costó encontrarlo.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireAdmin } from './auth'
import { withTenant } from './db/client'
import { hintFor, seal } from './crypto'
import { MODELOS } from './ai/models'

export type AjustesIA = {
  enabled: boolean
  provider: string
  model: string
  assistantName: string
  systemPrompt: string
  maxTurns: number
  handoffKeywords: string[]
  apiKeyHint: string | null
}

export async function getAjustesIA(): Promise<AjustesIA | null> {
  const session = await requireAdmin()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select enabled, provider, model, assistant_name, system_prompt,
             max_turns, handoff_keywords, api_key_hint
        from agent_configs where channel = 'whatsapp'
    `)
    const row = res.rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return {
      enabled: Boolean(row.enabled),
      provider: String(row.provider ?? 'anthropic'),
      model: String(row.model),
      assistantName: String(row.assistant_name ?? 'Asistente'),
      systemPrompt: String(row.system_prompt ?? ''),
      maxTurns: Number(row.max_turns ?? 6),
      handoffKeywords: (row.handoff_keywords as string[]) ?? [],
      apiKeyHint: row.api_key_hint ? String(row.api_key_hint) : null,
    }
  })
}

function volver(tipo: 'ok' | 'error' | 'prueba-ok' | 'prueba-error', msg?: string): never {
  const q = new URLSearchParams({ r: tipo })
  if (msg) q.set('m', msg.slice(0, 200))
  redirect(`/configuracion/ia?${q.toString()}`)
}

export async function guardarAjustesIA(formData: FormData): Promise<void> {
  const session = await requireAdmin()

  const provider = String(formData.get('provider') ?? 'anthropic')
  const model = String(formData.get('model') ?? '')
  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const assistantName = String(formData.get('assistantName') ?? '').trim().slice(0, 80)
  const systemPrompt = String(formData.get('systemPrompt') ?? '').trim()
  const enabled = formData.get('enabled') === 'on'
  const maxTurns = Math.min(20, Math.max(1, Number(formData.get('maxTurns') ?? 6)))
  const handoffRaw = String(formData.get('handoffKeywords') ?? '')

  // Validación del lado del servidor: el proveedor y el modelo tienen que
  // estar en la lista que ofrecemos. No se acepta lo que venga del formulario.
  const permitidos = MODELOS[provider]
  if (!permitidos) volver('error', 'Proveedor desconocido.')
  if (!permitidos.some((m) => m.id === model)) {
    volver('error', 'Ese modelo no corresponde al proveedor elegido.')
  }
  if (!systemPrompt) {
    volver('error', 'Las instrucciones del asistente no pueden quedar vacías.')
  }

  // Si prenden el asistente, tiene que haber una clave (nueva o ya guardada).
  if (enabled && !apiKey) {
    const yaTiene = await withTenant(session, async (tx) => {
      const r = await tx.execute(
        sql`select api_key_hint from agent_configs where channel = 'whatsapp'`,
      )
      return Boolean(r.rows[0]?.api_key_hint)
    })
    if (!yaTiene) {
      volver('error', 'Para activar el asistente hace falta cargar una clave de API.')
    }
  }

  const keywords = handoffRaw
    .split(/[\n,]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 100)

  await withTenant(session, async (tx) => {
    // La clave solo se toca si cargaron una nueva: así se puede editar el
    // resto sin tener que volver a escribirla.
    if (apiKey) {
      const sobre = JSON.stringify(seal(apiKey))
      await tx.execute(sql`
        update agent_configs set
          provider = ${provider}, model = ${model}, enabled = ${enabled},
          assistant_name = ${assistantName || 'Asistente'},
          system_prompt = ${systemPrompt}, max_turns = ${maxTurns},
          handoff_keywords = ${sql.param(keywords)},
          api_key_enc = ${sobre}::jsonb,
          api_key_hint = ${hintFor(apiKey)}
        where channel = 'whatsapp'
      `)
    } else {
      await tx.execute(sql`
        update agent_configs set
          provider = ${provider}, model = ${model}, enabled = ${enabled},
          assistant_name = ${assistantName || 'Asistente'},
          system_prompt = ${systemPrompt}, max_turns = ${maxTurns},
          handoff_keywords = ${sql.param(keywords)}
        where channel = 'whatsapp'
      `)
    }

    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, diff)
      values (${session.tenantId}, ${session.userId}, 'ai.settings_changed',
              'agent_config',
              ${JSON.stringify({ provider, model, enabled, claveNueva: Boolean(apiKey) })}::jsonb)
    `)
  })

  revalidatePath('/configuracion/ia')
  volver(
    'ok',
    enabled
      ? 'Guardado. El asistente está activo.'
      : 'Guardado. El asistente sigue apagado.',
  )
}

/** Verifica la clave contra el proveedor real antes de que la usen en vivo. */
export async function probarClave(formData: FormData): Promise<void> {
  await requireAdmin()
  const provider = String(formData.get('provider') ?? '')
  const apiKey = String(formData.get('apiKey') ?? '').trim()

  if (!apiKey) {
    volver('prueba-error', 'Pegá la clave en el campo de arriba y probá de nuevo.')
  }

  if (provider === 'openai') {
    const { probarClaveOpenAI } = await import('./ai/openai')
    const r = await probarClaveOpenAI(apiKey)
    if (r.ok) volver('prueba-ok', 'La clave de OpenAI funciona.')
    volver('prueba-error', r.error ?? 'No se pudo validar la clave.')
  }
  if (provider === 'anthropic') {
    const { probarClaveAnthropic } = await import('./ai/anthropic')
    const r = await probarClaveAnthropic(apiKey)
    if (r.ok) volver('prueba-ok', 'La clave de Anthropic funciona.')
    volver('prueba-error', r.error ?? 'No se pudo validar la clave.')
  }
  volver('prueba-error', 'Proveedor desconocido.')
}
