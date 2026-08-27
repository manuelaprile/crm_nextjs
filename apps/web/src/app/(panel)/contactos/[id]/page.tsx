import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { requireTenant } from '@/lib/auth'
import { getContact, getStages } from '@/lib/queries'
import { withTenant } from '@/lib/db/client'
import { setStage, addNote, updateContact, toggleTag } from '@/lib/actions'
import { IconBack } from '@/components/icons'
import { AccionesContacto } from './acciones'
import { fecha, fechaHora } from '@/lib/fechas'

export const dynamic = 'force-dynamic'

export default async function ContactoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ confirmar?: string }>
}) {
  const session = await requireTenant()
  const { id } = await params
  const { confirmar } = await searchParams

  const contact = await getContact(session, id)
  if (!contact) notFound()

  const [stages, allTags] = await Promise.all([
    getStages(session),
    withTenant(session, async (tx) => {
      const res = await tx.execute(sql`select id, name, color from tags order by name`)
      return (res.rows as Record<string, unknown>[]).map((t) => ({
        id: String(t.id),
        name: String(t.name),
        color: String(t.color),
      }))
    }),
  ])

  const tagIds = new Set(contact.tags.map((t) => t.id))

  return (
    <>
      <div className="topnav">
        <Link href="/contactos" className="btn btn-ghost btn-sm">
          <IconBack />
          Contactos
        </Link>
        <h2>{contact.displayName}</h2>
        {contact.stageName && (
          <span className="badge b-gray badge-dot">{contact.stageName}</span>
        )}
        {contact.archivado && <span className="badge b-amber">Archivado</span>}
      </div>

      <div className="content">
        <div className="cols2b">
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Datos</h3>
              </div>
              <div className="panel-box-body">
                <form action={updateContact} style={{ display: 'grid', gap: 14 }}>
                  <input type="hidden" name="contactId" value={contact.id} />
                  <Campo label="Nombre" name="displayName" value={contact.displayName} />
                  <Campo label="Ciudad / zona" name="city" value={contact.city ?? ''} />
                  <Campo label="Provincia" name="province" value={contact.province ?? ''} />
                  <div>
                    <button type="submit" className="btn btn-primary btn-sm">
                      Guardar
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Etapa</h3>
              </div>
              <div className="panel-box-body">
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
                    Cambiar
                  </button>
                </form>
              </div>
            </div>

            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Etiquetas</h3>
              </div>
              <div className="panel-box-body">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {allTags.map((t) => {
                    const activa = tagIds.has(t.id)
                    return (
                      <form key={t.id} action={toggleTag}>
                        <input type="hidden" name="contactId" value={contact.id} />
                        <input type="hidden" name="tagId" value={t.id} />
                        <button
                          type="submit"
                          className="badge"
                          style={{
                            background: `${t.color}1a`,
                            color: t.color,
                            opacity: activa ? 1 : 0.4,
                            cursor: 'pointer',
                          }}
                        >
                          {t.name}
                        </button>
                      </form>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Notas</h3>
              </div>
              <div className="panel-box-body">
                <form action={addNote} style={{ marginBottom: 16 }}>
                  <input type="hidden" name="contactId" value={contact.id} />
                  <textarea
                    name="body"
                    rows={3}
                    className="input"
                    placeholder="Nota administrativa…"
                    style={{ resize: 'vertical' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 9 }}
                  >
                    Agregar
                  </button>
                </form>

                {contact.notes.length === 0 ? (
                  <p className="muted tiny">Sin notas.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {contact.notes.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          background: 'var(--c-surface)',
                          borderRadius: 'var(--r-sm)',
                          padding: 11,
                        }}
                      >
                        <div style={{ fontSize: 13.5 }}>{n.body}</div>
                        <div className="tiny muted" style={{ marginTop: 5 }}>
                          {n.byAi ? 'IA · ' : ''}
                          {fechaHora(n.createdAt, session.tenantZona)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="panel-box">
              <div className="panel-box-head">
                <h3>Historial de etapas</h3>
              </div>
              <div className="panel-box-body">
                {contact.history.length === 0 ? (
                  <p className="muted tiny">Sin movimientos.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 2 }}>
                    {contact.history.map((h, i) => (
                      <div className="kv" key={i}>
                        <span
                          style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                        >
                          {h.toStage}
                          {h.byAi && <span className="badge b-blue">IA</span>}
                        </span>
                        <span className="tiny muted mono">
                          {fecha(h.createdAt, session.tenantZona)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <AccionesContacto
              contactId={contact.id}
              archivado={contact.archivado}
              confirmando={confirmar === 'borrar'}
              puedeEliminar={session.role !== 'agent'}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function Campo({
  label,
  name,
  value,
}: {
  label: string
  name: string
  value: string
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={value} className="input" />
    </div>
  )
}
