import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { getConversation, getContact, getStages } from '@/lib/queries'
import { adjuntosDe } from '@/lib/media'
import { AdjuntoEnMensaje } from './adjunto'
import { sendReply, toggleAi, setStage, addNote } from '@/lib/actions'
import { IconSend } from '@/components/icons'
import { ListaConversaciones, iniciales } from '../lista'
import { AlFinal } from './al-final'
import { AgendarDesdeChat } from './agendar'
import { configAgenda, proximoTurnoDe } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

/**
 * Una conversación abierta, con la lista al lado.
 *
 * Las tres columnas son las de WhatsApp Web y las del prototipo del cliente:
 * conversaciones, hilo y ficha del contacto. La del medio es la única que
 * cambia al saltar de un chat a otro.
 */
export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string; atiende?: string; p?: string; r?: string; m?: string }>
}) {
  const session = await requireTenant()
  const { id } = await params
  const { q, atiende, p, r, m } = await searchParams
  const filtro =
    atiende === 'ia' || atiende === 'humano' || atiende === 'visita'
      ? atiende
      : undefined

  const conversation = await getConversation(session, id)
  if (!conversation) notFound()

  const [contact, stages, agenda, proximoTurno] = await Promise.all([
    conversation.contactId ? getContact(session, conversation.contactId) : null,
    getStages(session),
    configAgenda(session.tenantId),
    conversation.contactId
      ? proximoTurnoDe(session.tenantId, conversation.contactId)
      : null,
  ])

  const desconectado = conversation.accountStatus !== 'connected'
  const nombre =
    conversation.participantName ?? conversation.participantPhone ?? 'Sin nombre'
  // Una sola consulta para todos los adjuntos de la conversación: uno por
  // mensaje sería una consulta por burbuja.
  const adjuntos = await adjuntosDe(conversation.messages.map((m) => m.id))

  const entrantes = conversation.messages.filter((m) => m.direction === 'inbound')

  return (
    <>
      <div className="topnav">
        <h2>Bandeja</h2>
      </div>

      <div className="wa">
        <ListaConversaciones
          session={session}
          activa={conversation.id}
          q={q}
          atiende={filtro}
          pagina={Number(p) || 1}
        />

        {/* ---------------- Hilo ---------------- */}
        <div className="wa-chat">
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

            <span
              className={`badge badge-dot ${
                conversation.aiEnabled ? 'b-blue' : 'b-gray'
              }`}
            >
              {conversation.aiEnabled ? 'Atiende la IA' : 'Atiende una persona'}
            </span>

            {/* Un solo botón con las dos direcciones: quién atiende el hilo es
                un interruptor, no dos acciones distintas. */}
            <form action={toggleAi}>
              <input type="hidden" name="conversationId" value={conversation.id} />
              <button type="submit" className="btn btn-ghost btn-sm">
                {conversation.aiEnabled
                  ? 'Tomar la conversación'
                  : 'Devolver a la IA'}
              </button>
            </form>

            <AgendarDesdeChat
              conversationId={conversation.id}
              contactId={conversation.contactId}
              nombre={nombre}
              zona={agenda.zona}
              proximo={proximoTurno}
            />
          </div>

          {m ? (
            <div
              className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
              style={{ margin: '12px 18px 0' }}
            >
              <span>{m}</span>
            </div>
          ) : null}

          <div className="wa-msgs">
            {conversation.messages.length === 0 && (
              <p className="muted tiny" style={{ textAlign: 'center', padding: 30 }}>
                Sin mensajes todavía.
              </p>
            )}
            {conversation.messages.map((m) => {
              const propio = m.direction === 'outbound'
                const suyos = adjuntos.get(m.id) ?? []
                return (
                <div key={m.id} className={`bub ${propio ? 'bub-out' : 'bub-in'}`}>
                  {m.body ??
                    (suyos.length ? null : (
                      <em style={{ opacity: 0.7 }}>[{m.type}]</em>
                    ))}
                  {suyos.map((a) => (
                    <AdjuntoEnMensaje key={a.id} a={a} cuerpo={m.body} />
                  ))}
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
            <AlFinal
              marca={`${conversation.id}:${
                conversation.messages[conversation.messages.length - 1]?.id ?? ''
              }`}
            />
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

        {/* ---------------- Ficha ---------------- */}
        <aside className="wa-side">
          {contact ? (
            <>
              <div className="wa-perfil">
                <span className="wa-perfil-avatar">
                  {iniciales(contact.displayName)}
                </span>
                <div className="wa-perfil-nombre">{contact.displayName}</div>
                <div className="tiny muted">
                  {[contact.city, contact.province].filter(Boolean).join(', ') ||
                    'Sin zona cargada'}
                </div>
                <Link
                  href={`/contactos/${contact.id}`}
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 12 }}
                >
                  Ver ficha completa
                </Link>
              </div>

              <h6>Resumen</h6>
              <div className="kv">
                <span className="muted">Etapa</span>
                <b>{contact.stageName ?? '—'}</b>
              </div>
              <div className="kv">
                <span className="muted">Escribió</span>
                <b>
                  {entrantes.length} mensaje{entrantes.length === 1 ? '' : 's'}
                </b>
              </div>
              <div className="kv">
                <span className="muted">Desde</span>
                <b>{new Date(contact.createdAt).toLocaleDateString('es-AR')}</b>
              </div>

              <h6>Mover de etapa</h6>
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
                {/* El asistente lee las notas para tener memoria del
                    contacto. Esta casilla es la salida para lo que se
                    escribe entre nosotros y no queremos que influya en
                    cómo se le contesta a la persona. */}
                <label
                  className="tiny muted"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 8,
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" name="privada" value="si" />
                  Solo para el equipo (el asistente no la lee)
                </label>
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
                  <div key={n.id} className="wa-nota">
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
