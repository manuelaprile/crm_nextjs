import Link from 'next/link'
import { sql } from 'drizzle-orm'
import { requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'
import {
  configAgenda,
  diaEnZona,
  horaEnZona,
  instanteDe,
  turnosEntre,
  type Turno,
} from '@/lib/agenda'
import {
  guardarTurno,
  moverTurno,
  estadoDeTurno,
  eliminarTurno,
} from '@/lib/agenda-acciones'

export const dynamic = 'force-dynamic'

/** Cuánto para atrás se puede mirar desde la pantalla. */
const DIAS_ATRAS = 30
const DIAS_ADELANTE = 180

const ESTADOS: Record<string, { label: string; badge: string }> = {
  programada: { label: 'En pie', badge: 'b-blue' },
  cumplida: { label: 'Vino', badge: 'b-green' },
  ausente: { label: 'No vino', badge: 'b-amber' },
  cancelada: { label: 'Cancelada', badge: 'b-gray' },
}

/**
 * La agenda: lo que viene, agrupado por día.
 *
 * Lista y no grilla, a pedido. La grilla muestra los huecos libres, que es
 * lo que importa cuando uno agenda; la lista muestra lo que hay que hacer,
 * que es lo que importa el resto del día. Los huecos los calcula el
 * asistente por su cuenta cuando ofrece horarios.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string; d?: string; ver?: string; editar?: string }>
}) {
  const session = await requireTenant()
  const { r, m, d, ver, editar } = await searchParams
  const config = await configAgenda(session.tenantId)

  const hoy = diaEnZona(new Date(), config.zona)
  const pasado = ver === 'pasado'

  // La ventana se ancla al arranque del día en la zona del negocio, no a
  // "ahora menos 24 horas": un turno de las 9 de la mañana tiene que seguir
  // en la lista a las 11.
  const arranqueHoy = instanteDe(hoy, '00:00', config.zona) ?? new Date()
  const desde = pasado
    ? new Date(arranqueHoy.getTime() - DIAS_ATRAS * 24 * 3_600_000)
    : arranqueHoy
  const hasta = pasado
    ? arranqueHoy
    : new Date(arranqueHoy.getTime() + DIAS_ADELANTE * 24 * 3_600_000)

  const turnos = await turnosEntre({
    tenantId: session.tenantId,
    desde,
    hasta,
    incluirCancelados: pasado,
  })
  const enEdicion = turnos.find((t) => t.id === editar)

  // Los contactos, para el desplegable. Los más recientes primero: agendar
  // a alguien que escribió hace un rato es el caso normal.
  const contactos = await withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select id, display_name, phone from contacts
       order by updated_at desc nulls last limit 300
    `)
    return res.rows as { id: string; display_name: string; phone: string | null }[]
  })

  // Agrupados por día del negocio.
  const porDia = new Map<string, Turno[]>()
  for (const t of turnos) {
    const dia = diaEnZona(new Date(t.inicia), config.zona)
    const lista = porDia.get(dia) ?? []
    lista.push(t)
    porDia.set(dia, lista)
  }
  const dias = [...porDia.keys()].sort()
  if (pasado) dias.reverse()

  const enPie = turnos.filter((t) => t.estado === 'programada').length

  return (
    <>
      <div className="topnav">
        <h2>Agenda</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link
            href={pasado ? '/agenda' : '/agenda?ver=pasado'}
            className="btn btn-ghost btn-sm"
          >
            {pasado ? 'Ver lo que viene' : 'Ver lo que pasó'}
          </Link>
          {session.role !== 'agent' && (
            <Link href="/configuracion/agenda" className="btn btn-ghost btn-sm">
              Configurar
            </Link>
          )}
        </div>
      </div>

      <div className="content">
        {m ? (
          <div
            className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
            style={{ marginBottom: 16 }}
          >
            <span>{m}</span>
          </div>
        ) : null}

        <div className="panel-box" style={{ marginBottom: 16 }}>
          <div className="panel-box-head">
            <h3>{enEdicion ? 'Mover turno' : 'Nuevo turno'}</h3>
            {enEdicion && (
              <span className="tiny muted">{enEdicion.titulo}</span>
            )}
          </div>
          <div className="panel-box-body">
            {enEdicion ? (
              <form action={moverTurno} style={{ display: 'grid', gap: 12 }}>
                <input type="hidden" name="id" value={enEdicion.id} />
                <div className="agenda-fila">
                  <div className="field">
                    <label htmlFor="dia">Día</label>
                    <input
                      id="dia" name="dia" type="date" className="input" required
                      defaultValue={diaEnZona(new Date(enEdicion.inicia), config.zona)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="desde">Desde</label>
                    <input
                      id="desde" name="desde" type="time" className="input" required
                      defaultValue={horaEnZona(new Date(enEdicion.inicia), config.zona)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="hasta">Hasta</label>
                    <input
                      id="hasta" name="hasta" type="time" className="input"
                      defaultValue={horaEnZona(new Date(enEdicion.termina), config.zona)}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary">Mover</button>
                  <Link href="/agenda" className="btn btn-ghost">Cancelar</Link>
                </div>
              </form>
            ) : (
              <form action={guardarTurno} style={{ display: 'grid', gap: 12 }}>
                <div className="agenda-fila">
                  <div className="field" style={{ flex: '2 1 220px' }}>
                    <label htmlFor="titulo">De qué es</label>
                    <input
                      id="titulo" name="titulo" className="input" required
                      maxLength={120} placeholder="Consulta inicial, visita a la propiedad…"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="tipo">Tipo</label>
                    <input id="tipo" name="tipo" className="input" maxLength={40}
                      placeholder="consulta, visita…" />
                  </div>
                </div>
                <div className="agenda-fila">
                  <div className="field">
                    <label htmlFor="ndia">Día</label>
                    <input id="ndia" name="dia" type="date" className="input"
                      required defaultValue={d || hoy} />
                  </div>
                  <div className="field">
                    <label htmlFor="ndesde">Desde</label>
                    <input id="ndesde" name="desde" type="time" className="input" required />
                  </div>
                  <div className="field">
                    <label htmlFor="nhasta">Hasta</label>
                    <input id="nhasta" name="hasta" type="time" className="input"
                      placeholder={`${config.duracionIaMin} min`} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="contactId">Contacto</label>
                  <select id="contactId" name="contactId" className="select">
                    <option value="">Sin contacto</option>
                    {contactos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="notas">Notas</label>
                  <textarea id="notas" name="notas" className="input" rows={2}
                    maxLength={2000} />
                </div>
                <div>
                  <button type="submit" className="btn btn-primary">Agendar</button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="panel-box">
          <div className="panel-box-head">
            <h3>{pasado ? 'Turnos pasados' : 'Lo que viene'}</h3>
            {!pasado && (
              <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                {enPie} en pie
              </span>
            )}
          </div>
          <div className="panel-box-body">
            {dias.length === 0 ? (
              <div className="empty">
                <b>{pasado ? 'No hay turnos anteriores' : 'No hay turnos agendados'}</b>
                {pasado ? '' : 'Cargá el primero con el formulario de arriba.'}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 20 }}>
                {dias.map((dia) => (
                  <div key={dia}>
                    <div className="agenda-dia">
                      {rotuloDeDia(dia, hoy, config.zona)}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {(porDia.get(dia) ?? []).map((t) => {
                        const est = ESTADOS[t.estado] ?? ESTADOS.programada!
                        return (
                          <div key={t.id} className="agenda-turno">
                            <span className="agenda-hora mono">
                              {horaEnZona(new Date(t.inicia), config.zona)}
                              <small>
                                {horaEnZona(new Date(t.termina), config.zona)}
                              </small>
                            </span>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <strong style={{ fontSize: 13.5 }}>{t.titulo}</strong>
                                <span className={`badge ${est.badge}`}>{est.label}</span>
                                {t.creadoPorIa && (
                                  <span className="badge b-blue">La agendó la IA</span>
                                )}
                              </div>
                              <div className="tiny muted" style={{ marginTop: 3 }}>
                                {t.contacto ? (
                                  t.conversationId ? (
                                    <Link href={`/bandeja/${t.conversationId}`}>
                                      {t.contacto}
                                    </Link>
                                  ) : (
                                    t.contacto
                                  )
                                ) : (
                                  'Sin contacto'
                                )}
                                {t.tipo ? ` · ${t.tipo}` : ''}
                                {t.notas ? ` · ${t.notas}` : ''}
                              </div>
                            </div>
                            <div className="agenda-acciones">
                              <Link href={`/agenda?editar=${t.id}${pasado ? '&ver=pasado' : ''}`}
                                className="btn btn-ghost btn-sm">
                                Mover
                              </Link>
                              {t.estado === 'programada' ? (
                                <>
                                  <BotonEstado id={t.id} estado="cumplida" texto="Vino" />
                                  <BotonEstado id={t.id} estado="ausente" texto="No vino" />
                                  <BotonEstado id={t.id} estado="cancelada" texto="Cancelar" />
                                </>
                              ) : (
                                <BotonEstado id={t.id} estado="programada" texto="Reactivar" />
                              )}
                              <form action={eliminarTurno}>
                                <input type="hidden" name="id" value={t.id} />
                                <button type="submit" className="btn btn-ghost btn-sm">
                                  Eliminar
                                </button>
                              </form>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function BotonEstado({
  id,
  estado,
  texto,
}: {
  id: string
  estado: string
  texto: string
}) {
  return (
    <form action={estadoDeTurno}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="estado" value={estado} />
      <button type="submit" className="btn btn-ghost btn-sm">
        {texto}
      </button>
    </form>
  )
}

/** "Hoy", "Mañana", o el día escrito completo. */
function rotuloDeDia(dia: string, hoy: string, zona: string): string {
  if (dia === hoy) return 'Hoy'
  const [a, m, d] = dia.split('-').map(Number)
  const [ha, hm, hd] = hoy.split('-').map(Number)
  const dias = Math.round(
    (Date.UTC(a!, m! - 1, d!) - Date.UTC(ha!, hm! - 1, hd!)) / 86_400_000,
  )
  if (dias === 1) return 'Mañana'
  if (dias === -1) return 'Ayer'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: zona,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(a!, m! - 1, d!, 12)))
}
