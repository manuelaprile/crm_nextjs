'use client'

import { useState } from 'react'
import { guardarAjustesIA, probarClave, type AjustesIA } from '@/lib/ai-settings'
import { MODELOS } from '@/lib/ai/models'

const PROVEEDORES = [
  { id: 'openai', label: 'OpenAI (ChatGPT)', donde: 'platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', donde: 'console.anthropic.com' },
]

export type Aviso = { tipo: 'ok' | 'error'; texto: string } | null

export function FormIA({
  inicial,
  aviso,
  avisoPrueba,
}: {
  inicial: AjustesIA
  aviso: Aviso
  avisoPrueba: Aviso
}) {
  const [provider, setProvider] = useState(inicial.provider)
  const [model, setModel] = useState(inicial.model)
  const [apiKey, setApiKey] = useState('')

  const modelos = MODELOS[provider] ?? []

  function cambiarProveedor(nuevo: string) {
    setProvider(nuevo)
    // Al cambiar de proveedor el modelo anterior no existe: se elige el
    // primero del nuevo, que además es el más barato de la lista.
    setModel(MODELOS[nuevo]?.[0]?.id ?? '')
  }

  return (
    <form action={guardarAjustesIA} style={{ display: 'grid', gap: 16, maxWidth: 680 }}>
      {aviso && (
        <div className={`alert ${aviso.tipo === 'ok' ? 'alert-green' : 'alert-red'}`}>
          {aviso.texto}
        </div>
      )}

      {/* ---- Proveedor ---- */}
      <div className="panel-box">
        <div className="panel-box-head">
          <div>
            <h3>Proveedor</h3>
            <p className="tiny muted" style={{ marginTop: 3 }}>
              Qué motor usa el asistente. La clave la pagás directamente al
              proveedor.
            </p>
          </div>
        </div>
        <div className="panel-box-body" style={{ display: 'grid', gap: 16 }}>
          <div className="cols2b">
            {PROVEEDORES.map((p) => (
              <label
                key={p.id}
                style={{
                  cursor: 'pointer',
                  position: 'relative',
                  border: `1px solid ${
                    provider === p.id ? 'var(--c-primary)' : 'var(--c-border)'
                  }`,
                  background:
                    provider === p.id ? 'var(--c-primary-soft)' : 'var(--c-bg)',
                  borderRadius: 'var(--r-md)',
                  padding: 13,
                  transition: '.15s',
                }}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p.id}
                  checked={provider === p.id}
                  onChange={() => cambiarProveedor(p.id)}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                />
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>
                  {p.label}
                </span>
                <span
                  className="tiny muted"
                  style={{ display: 'block', marginTop: 2 }}
                >
                  {p.donde}
                </span>
              </label>
            ))}
          </div>

          <div className="field">
            <label htmlFor="apiKey">Clave de API</label>
            <input
              id="apiKey"
              name="apiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="input mono"
              placeholder={
                inicial.apiKeyHint
                  ? `Guardada: ${inicial.apiKeyHint} — dejá vacío para no cambiarla`
                  : provider === 'openai'
                    ? 'sk-proj-...'
                    : 'sk-ant-...'
              }
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                marginTop: 4,
              }}
            >
              <button
                type="submit"
                formAction={probarClave}
                className="btn btn-ghost btn-sm"
              >
                Probar la clave
              </button>
              {avisoPrueba && (
                <span
                  className="tiny"
                  style={{
                    color:
                      avisoPrueba.tipo === 'ok'
                        ? 'var(--c-success)'
                        : 'var(--c-danger)',
                  }}
                >
                  {avisoPrueba.texto}
                </span>
              )}
            </div>
            <p className="tiny muted">
              Se guarda cifrada. Ni el panel ni nadie con acceso a la base puede
              leerla en claro.
            </p>
          </div>

          <div className="field">
            <label htmlFor="model">Modelo</label>
            <select
              id="model"
              name="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="select"
            >
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="tiny muted">
              {modelos.find((m) => m.id === model)?.nota}
            </p>
          </div>
        </div>
      </div>

      {/* ---- Comportamiento ---- */}
      <div className="panel-box">
        <div className="panel-box-head">
          <h3>Comportamiento</h3>
        </div>
        <div className="panel-box-body" style={{ display: 'grid', gap: 16 }}>
          <div className="field">
            <label htmlFor="assistantName">Nombre del asistente</label>
            <input
              id="assistantName"
              name="assistantName"
              defaultValue={inicial.assistantName}
              maxLength={80}
              className="input"
            />
          </div>

          <div className="field">
            <label htmlFor="systemPrompt">Instrucciones</label>
            <textarea
              id="systemPrompt"
              name="systemPrompt"
              rows={18}
              defaultValue={inicial.systemPrompt}
              className="input mono"
              style={{ fontSize: 12, lineHeight: 1.6, resize: 'vertical' }}
            />
            <p className="tiny muted">
              Leelas con el doctor antes de activar. Las reglas de qué NO puede
              decir son la parte importante.
            </p>
          </div>

          <div className="field">
            <label htmlFor="handoffKeywords">
              Palabras que derivan a un humano
            </label>
            <textarea
              id="handoffKeywords"
              name="handoffKeywords"
              rows={3}
              defaultValue={inicial.handoffKeywords.join(', ')}
              className="input"
              style={{ resize: 'vertical' }}
            />
            <p className="tiny muted">
              Separadas por coma. Si el paciente escribe alguna, el asistente se
              calla y pasa la conversación a la secretaria — sin consultar al
              modelo, así que es infalible.
            </p>
          </div>

          <div className="field">
            <label htmlFor="maxTurns">Máximo de intercambios</label>
            <input
              id="maxTurns"
              name="maxTurns"
              type="number"
              min={1}
              max={20}
              defaultValue={inicial.maxTurns}
              className="input mono"
              style={{ width: 110 }}
            />
            <p className="tiny muted">
              Tope de vueltas por conversación. Evita que una charla se vaya de
              costo.
            </p>
          </div>
        </div>
      </div>

      {/* ---- Interruptor ---- */}
      <div className="panel-box">
        <div className="panel-box-body">
          <label
            style={{
              display: 'flex',
              gap: 11,
              alignItems: 'flex-start',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={inicial.enabled}
              style={{ marginTop: 3, width: 16, height: 16 }}
            />
            <span>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>
                Activar el asistente
              </span>
              <span
                className="tiny muted"
                style={{ display: 'block', marginTop: 2 }}
              >
                Cuando está activo responde automáticamente las consultas nuevas.
                Cada conversación tiene además su propio interruptor en la
                bandeja.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div>
        <button type="submit" className="btn btn-primary">
          Guardar
        </button>
      </div>
    </form>
  )
}
