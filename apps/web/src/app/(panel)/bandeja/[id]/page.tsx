import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { getConversation, getContact, getStages } from '@/lib/queries'
import { sendReply, toggleAi, setStage, addNote } from '@/lib/actions'
import { IconBack, IconSend } from '@/components/icons'

export const dynamic = 'force-dynamic'

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireTenant()
  const { id } = await params

  const conversation = await getConversation(session, id)
  if (!conversation) notFound()

  const [contact, stages] = await Promise.all([
    conversation.contactId ? getContact(session, conversation.contactId) : null,
    getStages(session),
  ])

  const desconectado = conversation.accountStatus !== 'connected'
  const nombre =
    conversation.participantName ?? conversation.participantPhone ?? 'Sin nombre'

  return (
    <>
      <div className="topnav">
        <Link href="/bandeja" className="btn btn-ghost btn-sm">
          <IconBack />
          Bandeja
        </Link>
        <h2>{nombre}</h2>
      </div>

      <div className="wa">
        {/* ---- Chat ---- */}
        <div className="wa-chat" style={{ gridColumn: '1 / span 2' }}>
          <div className="wa-chat-head">
            <span className="avatar">{iniciales(nombre)}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{nombre}</div>
              <div className="tiny muted mono">
                {conversation.participantPhone
                  ? `+${conversation.participantPhone}`
                  : '—'}
              </div>
            </div>
            <form action={toggleAi}>
              <input type="hidden" name="conversationId" value={conversation.id} />
              <button
                type="submit"
                className={`badge ${conversation.aiEnabled ? 'b-blue' : 'b-gray'}`}
                style={{ cursor: 'pointer' }}
              >
                {conversation.aiEnabled ? 'IA activa' : 'IA apagada'}
              </button>
            </form>
          </div>

          <div className="wa-msgs">
            {conversation.messages.length === 0 && (
              <p className="muted tiny" style={{ textAlign: 'center', padding: 30 }}>
                Sin mensajes todavía.
              </p>
            )}
            {conversation.messages.map((m) => {
              const propio = m.direction === 'outbound'
              return (
                <div
                  key={m.id}
                  className={`bub ${propio ? 'bub-out' : 'bub-in'}`}
                >
                  {m.body ?? <em style={{ opacity: 0.7 }}>[{m.type}]</em>}
                  <div className="t">
                    {new Date(m.createdAt).toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {m.senderKind === 'ai' && ' · IA'}
                    {m.status === 'pending' && ' · enviando'}
                    {m.status === 'failed' && ' · falló'}
                  </div>
                  {m.status === 'failed' && m.error && (
                    <div className="t" style={{ opacity: 0.85 }}>
                      {m.error}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ background: 'var(--c-bg)' }}>
            {desconectado && (
              <div
                className="alert alert-amber"
                style={{ margin: '13px 18px 0', borderRadius: 'var(--r-md)' }}
              >
                <span>
                  WhatsApp no está conectado: el mensaje va a quedar como
                  fallido.{' '}
                  <Link
                    href="/configuracion/whatsapp"
                    style={{ textDecoration: 'underline' }}
                  >
                    Reconectar
                  </Link>
                </span>
              </div>
            )}
            <form action={sendReply} className="wa-input">
              <input type="hidden" name="conversationId" value={conversation.id} />
              <input
                name="text"
                placeholder="Escribí una respuesta…"
                autoComplete="off"
                maxLength={4000}
              />
              <button type="submit" className="btn btn-primary">
                <IconSend />
                Enviar
              </button>
            </form>
            <p
              className="tiny muted"
              style={{ padding: '0 18px 12px', marginTop: -4 }}
            >
              Al responder a mano se apaga la IA de esta conversación.
            </p>
          </div>
        </div>

        {/* ---- Ficha ---- */}
        <aside className="wa-side">
          {contact ? (
            <>
              <h6>Contacto</h6>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {contact.displayName}
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                Desde {new Date(contact.createdAt).toLocaleDateString('es-AR')}
              </div>
              <Link
                href={`/contactos/${contact.id}`}
                className="btn btn-ghost btn-sm btn-block"
                style={{ marginTop: 10 }}
              >
                Ver ficha completa
              </Link>

              <h6>Etapa</h6>
              <form action={setStage} style={{ display: 'flex', gap: 8 }}>
                <input type="hidden" name="contactId" value={contact.id} />
                <select
                  name="stageId"
                  defaultValue={contact.stageId ?? ''}
                  className="select"
                  style={{ flex: 1 }}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-ghost btn-sm">
                  Guardar
                </button>
              </form>

              {(contact.city || contact.province) && (
                <>
                  <h6>Zona</h6>
                  <div className="kv">
                    <span className="muted">Ciudad</span>
                    <b>{[contact.city, contact.province].filter(Boolean).join(', ')}</b>
                  </div>
                </>
              )}

              {contact.tags.length > 0 && (
                <>
                  <h6>Etiquetas</h6>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {contact.tags.map((t) => (
                      <span
                        key={t.id}
                        className="badge"
                        style={{ background: `${t.color}1a`, color: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </>
              )}

              <h6>Notas</h6>
              <form action={addNote}>
                <input type="hidden" name="contactId" value={contact.id} />
                <textarea
                  name="body"
                  rows={2}
                  className="input"
                  placeholder="Agregar una nota…"
                  style={{ resize: 'none' }}
                />
                <button
                  type="submit"
                  className="btn btn-ghost btn-sm btn-block"
                  style={{ marginTop: 8 }}
                >
                  Guardar nota
                </button>
              </form>
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {contact.notes.slice(0, 8).map((n) => (
                  <div
                    key={n.id}
                    style={{
                      background: 'var(--c-surface)',
                      borderRadius: 'var(--r-sm)',
                      padding: 10,
                    }}
                  >
                    <div style={{ fontSize: 12.5 }}>{n.body}</div>
                    <div className="tiny muted" style={{ marginTop: 4 }}>
                      {n.byAi ? 'IA · ' : ''}
                      {new Date(n.createdAt).toLocaleDateString('es-AR')}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted tiny">
              Esta conversación no tiene un contacto asociado.
            </p>
          )}
        </aside>
      </div>
    </>
  )
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
