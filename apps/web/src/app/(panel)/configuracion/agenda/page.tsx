import { sql } from 'drizzle-orm'
import { requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'
import { configAgenda } from '@/lib/agenda'
import { guardarConfigAgenda } from '@/lib/agenda-acciones'

export const dynamic = 'force-dynamic'

const DIAS = [
  { n: '1', label: 'Lunes' },
  { n: '2', label: 'Martes' },
  { n: '3', label: 'Miércoles' },
  { n: '4', label: 'Jueves' },
  { n: '5', label: 'Viernes' },
  { n: '6', label: 'Sábado' },
  { n: '0', label: 'Domingo' },
]

export default async function ConfigAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  const { r, m } = await searchParams
  const config = await configAgenda(session.tenantId)
  const puedeEditar = session.role !== 'agent'

  const etapas = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select id, name from stages where not is_lost order by position
    `)
    return res.rows as { id: string; name: string }[]
  })

  return (
    <>
      {m ? (
        <div
          className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
          style={{ marginBottom: 16 }}
        >
          <span>{m}</span>
        </div>
      ) : null}

      <div className="page-head">
        <p style={{ marginTop: 0 }}>
          Horarios de atención y qué puede hacer el asistente con la agenda
        </p>
      </div>

      <form action={guardarConfigAgenda}>
        <fieldset disabled={!puedeEditar} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="panel-box" style={{ marginBottom: 16 }}>
            <div className="panel-box-head">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                Horarios de atención
                {/*
                  El estado en el que está HOY, no una explicación de la
                  regla. Sin horarios cargados el negocio queda abierto
                  siempre, y eso tiene que verse: es la diferencia entre que
                  el asistente ofrezca un turno a las 3 de la mañana y que
                  alguien se entere de por qué.
                */}
                {config.horariosPorDefecto && (
                  <span className="badge b-blue">Abierto las 24 h</span>
                )}
              </h3>
              <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                {config.zona}
              </span>
            </div>
            <div className="panel-box-body">
              <div style={{ display: 'grid', gap: 8 }}>
                {DIAS.map((d) => {
                  // Los campos quedan vacíos cuando el 24 h es el valor por
                  // defecto: llenarlos con 00:00 y 24:00 haría parecer que
                  // alguien eligió eso, y el primer guardado convertiría un
                  // default en una decisión que nadie tomó.
                  const tramo = config.horariosPorDefecto
                    ? undefined
                    : config.horarios[d.n]?.[0]
                  return (
                    <div key={d.n} className="horario">
                      <span className="horario-dia">{d.label}</span>
                      <div className="field">
                        <label htmlFor={`abre_${d.n}`} className="tiny">Abre</label>
                        <input
                          id={`abre_${d.n}`} name={`abre_${d.n}`} type="time"
                          className="input" defaultValue={tramo?.[0] ?? ''}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`cierra_${d.n}`} className="tiny">Cierra</label>
                        <input
                          id={`cierra_${d.n}`} name={`cierra_${d.n}`} type="time"
                          className="input" defaultValue={tramo?.[1] ?? ''}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="panel-box" style={{ marginBottom: 16 }}>
            <div className="panel-box-head">
              <h3>Al agendar</h3>
            </div>
            <div className="panel-box-body" style={{ display: 'grid', gap: 12 }}>
              <div className="field">
                <label htmlFor="etapa">Mover el contacto a</label>
                <select id="etapa" name="etapa" className="select"
                  defaultValue={config.etapaAlAgendar ?? ''}>
                  <option value="">No mover</option>
                  {etapas.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="panel-box" style={{ marginBottom: 16 }}>
            <div className="panel-box-head">
              <h3>El asistente</h3>
            </div>
            <div className="panel-box-body" style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <input type="checkbox" name="iaAgenda" value="si"
                  defaultChecked={config.iaAgenda} style={{ marginTop: 3 }} />
                <span>
                  <strong style={{ fontSize: 13.5 }}>
                    Que el asistente reserve turnos
                  </strong>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    Ofrece horarios libres y confirma en el momento. Sin esto,
                    deriva a una persona.
                  </span>
                </span>
              </label>

              <div className="agenda-fila">
                <div className="field">
                  <label htmlFor="duracion">Duración del turno (min)</label>
                  <input id="duracion" name="duracion" type="number" className="input"
                    min={5} max={480} step={5} defaultValue={config.duracionIaMin} />
                </div>
                <div className="field">
                  <label htmlFor="anticipacion">Anticipación mínima (horas)</label>
                  <input id="anticipacion" name="anticipacion" type="number"
                    className="input" min={0} max={168}
                    defaultValue={config.anticipacionHoras} />
                </div>
                <div className="field">
                  <label htmlFor="horizonte">Hasta cuántos días adelante</label>
                  <input id="horizonte" name="horizonte" type="number" className="input"
                    min={1} max={365} defaultValue={config.horizonteDias} />
                </div>
              </div>

              <div className="field">
                <label htmlFor="palabras">Ofrecer turno cuando aparezca</label>
                <textarea id="palabras" name="palabras" className="input" rows={4}
                  defaultValue={config.palabrasClave.join('\n')}
                  placeholder={'turno\ncita\nvisita\ncuándo puedo ir\nquiero verlo'} />
              </div>
            </div>
          </div>

          {puedeEditar && (
            <button type="submit" className="btn btn-primary">Guardar</button>
          )}
        </fieldset>
      </form>
    </>
  )
}
