import Link from 'next/link'
import { sql } from 'drizzle-orm'
import { requireTenant } from '@/lib/auth'
import { withTenant } from '@/lib/db/client'
import { usuariosDeLaCuenta } from '@/lib/asignacion'
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
  asignarTurno,
} from '@/lib/agenda-acciones'
import { IconLista } from '@/components/icons'
import {
  Grilla,
  Mes,
  diasDelMes,
  lunesDe,
  primeroDelMes,
  sumarDias,
} from './calendario'

export const dynamic = 'force-dynamic'

/** Cuánto para atrás se puede mirar desde la lista. */
const DIAS_ATRAS = 30
const DIAS_ADELANTE = 180

const ESTADOS: Record<string, { label: string; badge: string }> = {
  programada: { label: 'En pie', badge: 'b-blue' },
  cumplida: { label: 'Vino', badge: 'b-green' },
  ausente: { label: 'No vino', badge: 'b-amber' },
  cancelada: { label: 'Cancelada', badge: 'b-gray' },
}

/**
 * Las cuatro vistas.
 *
 * «Lista» lleva icono y las otras tres no, y eso es a propósito: las tres
 * primeras son el mismo calendario con más o menos zoom, y la cuarta es otra
 * cosa. Puestas las cuatro iguales, la única que no era un calendario pasaba
 * desapercibida. Es el mismo icono que el de Contactos, que ya significa
 * "verlo como lista" en este panel.
 */
const VISTAS = [
  { id: 'mes', label: 'Mes', icono: false },
  { id: 'semana', label: 'Semana', icono: false },
  { id: 'dia', label: 'Día', icono: false },
  { id: 'lista', label: 'Lista', icono: true },
] as const

type Vista = (typeof VISTAS)[number]['id']

/**
 * La agenda.
 *
 * Cuatro vistas de los mismos datos, y cada una contesta una pregunta
 * distinta: el mes, "cómo viene el mes"; la semana, "cuánto tengo encima";
 * el día, "qué hago hoy"; la lista, "qué hay pendiente", que es la que
 * estaba y sigue siendo la mejor para trabajar de a un turno.
 *
 * QUIÉN VE QUÉ: un operador ve solo los turnos que lo involucran —los suyos,
 * los que cargó, y los de los contactos que sigue—. El dueño y los admin ven
 * todo y pueden filtrar por persona. Es el alcance de esta pantalla y no una
 * barrera de seguridad, igual que en Contactos (ver CLAUDE.md).
 *
 * Sin JavaScript: cambiar de vista, moverse de semana y abrir un turno son
 * enlaces. Lo único que necesita cliente es nada.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{
    r?: string
    m?: string
    /** Día ancla de la vista, "AAAA-MM-DD". */
    d?: string
    vista?: string
    ver?: string
    /** Turno abierto en el panel de detalle. */
    turno?: string
    /** Id de contacto: viene de "Agendar" en la tarjeta del tablero. */
    contacto?: string
    /** Filtro por responsable, solo para owner/admin. */
    usuario?: string
  }>
}) {
  const session = await requireTenant()
  const { r, m, d, vista, ver, turno, contacto, usuario } = await searchParams
  const config = await configAgenda(session.tenantId)

  const hoy = diaEnZona(new Date(), config.zona)
  const esAdmin = session.role !== 'agent'
  const pasado = ver === 'pasado'

  const v: Vista =
    (VISTAS.find((x) => x.id === vista)?.id as Vista | undefined) ?? 'semana'
  const ancla = /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? d! : hoy

  /**
   * De quién son los turnos que se piden.
   *
   * Para un operador no es un filtro que pueda sacar: es su pantalla. Para
   * un dueño es opcional, y por eso el desplegable solo se dibuja para él.
   */
  const soloDe = esAdmin ? usuario || undefined : session.userId

  // ---- La ventana de tiempo que necesita cada vista ------------------
  const arranque = (dia: string) => instanteDe(dia, '00:00', config.zona) ?? new Date()
  let desde: Date
  let hasta: Date
  let dias: string[] = []

  if (v === 'dia') {
    dias = [ancla]
    desde = arranque(ancla)
    hasta = arranque(sumarDias(ancla, 1))
  } else if (v === 'semana') {
    const lunes = lunesDe(ancla)
    dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
    desde = arranque(lunes)
    hasta = arranque(sumarDias(lunes, 7))
  } else if (v === 'mes') {
    // La grilla del mes arranca el lunes anterior al día 1 y son seis
    // semanas fijas, así que la ventana tiene que cubrir eso y no el mes.
    const inicio = lunesDe(primeroDelMes(ancla))
    desde = arranque(inicio)
    hasta = arranque(sumarDias(inicio, 42))
  } else {
    const arranqueHoy = arranque(hoy)
    desde = pasado
      ? new Date(arranqueHoy.getTime() - DIAS_ATRAS * 24 * 3_600_000)
      : arranqueHoy
    hasta = pasado
      ? arranqueHoy
      : new Date(arranqueHoy.getTime() + DIAS_ADELANTE * 24 * 3_600_000)
  }

  const turnos = await turnosEntre({
    tenantId: session.tenantId,
    desde,
    hasta,
    // En el calendario los cancelados se ven, apagados: que un horario haya
    // quedado libre es justamente lo que se está mirando. En la lista son
    // ruido, y ahí siguen apareciendo solo con "lo que pasó".
    incluirCancelados: v !== 'lista' || pasado,
    soloDe,
  })

  const [usuarios, contactos] = await Promise.all([
    usuariosDeLaCuenta(session),
    // Los contactos, para el desplegable. Los más recientes primero:
    // agendar a alguien que escribió hace un rato es el caso normal.
    withTenant(session, async (tx) => {
      const res = await tx.execute(sql`
        select id, display_name, phone from contacts
         order by updated_at desc nulls last limit 300
      `)
      return res.rows as { id: string; display_name: string; phone: string | null }[]
    }),
  ])

  // Si se vino desde una tarjeta, el formulario arranca con esa persona
  // puesta y el título escrito.
  const elegido = contacto ? contactos.find((c) => c.id === contacto) : undefined
  const abierto = turno ? turnos.find((t) => t.id === turno) : undefined

  /** Los enlaces llevan la vista, el día y el filtro. Sin esto, cada clic vuelve al principio. */
  const href = (extra: Record<string, string | undefined> = {}) => {
    const sp = new URLSearchParams()
    if (v !== 'semana') sp.set('vista', v)
    if (ancla !== hoy) sp.set('d', ancla)
    if (usuario) sp.set('usuario', usuario)
    if (pasado) sp.set('ver', 'pasado')
    for (const [k, val] of Object.entries(extra)) {
      if (val === undefined) sp.delete(k)
      else sp.set(k, val)
    }
    const s = sp.toString()
    return s ? `/agenda?${s}` : '/agenda'
  }

  const salto = v === 'dia' ? 1 : v === 'semana' ? 7 : 0
  const anterior =
    v === 'mes' ? mesVecino(ancla, -1) : salto ? sumarDias(ancla, -salto) : null
  const siguiente =
    v === 'mes' ? mesVecino(ancla, 1) : salto ? sumarDias(ancla, salto) : null

  const quien = usuario ? usuarios.find((u) => u.id === usuario)?.nombre : null

  return (
    <>
      <div className="topnav">
        <h2>Agenda</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {esAdmin && (
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

        {/* ---- Barra: vistas, navegación y responsable ---- */}
        <div className="ag-barra">
          <div className="ag-vistas">
            {VISTAS.map((x) => (
              <Link
                key={x.id}
                href={href({ vista: x.id === 'semana' ? undefined : x.id, turno: undefined })}
                className={`chip${v === x.id ? ' on' : ''}`}
              >
                {x.icono ? <IconLista /> : null}
                {x.label}
              </Link>
            ))}
          </div>

          {v === 'lista' ? (
            <Link href={href({ ver: pasado ? undefined : 'pasado' })} className="btn btn-ghost btn-sm">
              {pasado ? 'Ver lo que viene' : 'Ver lo que pasó'}
            </Link>
          ) : (
            <div className="ag-nav">
              <Link href={href({ d: anterior ?? undefined, turno: undefined })} className="btn btn-ghost btn-sm">
                ‹
              </Link>
              <Link href={href({ d: undefined, turno: undefined })} className="btn btn-ghost btn-sm">
                Hoy
              </Link>
              <Link href={href({ d: siguiente ?? undefined, turno: undefined })} className="btn btn-ghost btn-sm">
                ›
              </Link>
              <b className="ag-titulo">{tituloDe(v, ancla, dias, config.zona)}</b>
            </div>
          )}

          {esAdmin ? (
            <form action="/agenda" className="ag-quien">
              {v !== 'semana' ? <input type="hidden" name="vista" value={v} /> : null}
              {ancla !== hoy ? <input type="hidden" name="d" value={ancla} /> : null}
              <label htmlFor="usuario" className="tiny muted">
                A cargo de
              </label>
              <select
                id="usuario"
                name="usuario"
                className="select select-sm"
                defaultValue={usuario ?? ''}
              >
                <option value="">Todos</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-ghost btn-sm">
                Filtrar
              </button>
            </form>
          ) : (
            <span className="tiny muted ag-mios">Tus turnos</span>
          )}
        </div>

        {quien ? (
          <p className="tiny muted" style={{ margin: '0 0 12px' }}>
            Mostrando solo lo de {quien}.{' '}
            <Link href={href({ usuario: undefined })}>Ver todo</Link>
          </p>
        ) : null}

        {/* ---- El turno abierto ---- */}
        {abierto ? (
          <Detalle
            t={abierto}
            zona={config.zona}
            usuarios={usuarios}
            puedeAsignar={esAdmin}
            volver={href({ turno: undefined })}
          />
        ) : null}

        {/* ---- Cargar uno nuevo ---- */}
        <details className="panel-box ag-nuevo" open={Boolean(elegido)} style={{ marginBottom: 16 }}>
          <summary className="panel-box-head">
            <h3>Nuevo turno</h3>
          </summary>
          <div className="panel-box-body">
            <form action={guardarTurno} style={{ display: 'grid', gap: 12 }}>
              <div className="agenda-fila">
                <div className="field" style={{ flex: '2 1 220px' }}>
                  <label htmlFor="titulo">De qué es</label>
                  <input
                    id="titulo" name="titulo" className="input" required
                    maxLength={120} placeholder="Consulta inicial, visita a la propiedad…"
                    defaultValue={elegido ? `Turno de ${elegido.display_name}` : ''}
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
                    required defaultValue={ancla} />
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
              <div className="agenda-fila">
                <div className="field" style={{ flex: '2 1 220px' }}>
                  <label htmlFor="contactId">Contacto</label>
                  <select
                    id="contactId"
                    name="contactId"
                    className="select"
                    defaultValue={elegido?.id ?? ''}
                  >
                    <option value="">Sin contacto</option>
                    {contactos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {esAdmin ? (
                  <div className="field">
                    <label htmlFor="asignadoA">A cargo de</label>
                    <select id="asignadoA" name="asignadoA" className="select" defaultValue="">
                      {/*
                        Vacío no es "sin responsable": es "el que ya sigue a
                        este contacto", que es lo que resuelve `crearTurno`.
                      */}
                      <option value="">Según el contacto</option>
                      {usuarios
                        .filter((u) => !u.deshabilitado)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.nombre}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : null}
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
          </div>
        </details>

        {/* ---- La vista ---- */}
        {v === 'lista' ? (
          <Lista turnos={turnos} config={config} hoy={hoy} pasado={pasado} href={href} />
        ) : v === 'mes' ? (
          <div className="panel-box">
            <div className="panel-box-body" style={{ padding: 12 }}>
              <Mes ancla={ancla} turnos={turnos} config={config} hoy={hoy} href={href} />
            </div>
          </div>
        ) : (
          <div className="panel-box">
            <div className="panel-box-body" style={{ padding: 0 }}>
              {turnos.length === 0 ? (
                <div className="empty">
                  <b>Nada agendado</b>
                  {soloDe && !esAdmin
                    ? 'No tenés turnos en estos días.'
                    : 'Cargá uno con «Nuevo turno».'}
                </div>
              ) : null}
              <Grilla dias={dias} turnos={turnos} config={config} hoy={hoy} href={href} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------

/** El turno abierto, con todo lo que se puede hacer con él. */
function Detalle({
  t,
  zona,
  usuarios,
  puedeAsignar,
  volver,
}: {
  t: Turno
  zona: string
  usuarios: { id: string; nombre: string; deshabilitado: boolean }[]
  puedeAsignar: boolean
  volver: string
}) {
  const est = ESTADOS[t.estado] ?? ESTADOS.programada!
  return (
    <div className="panel-box" style={{ marginBottom: 16 }}>
      <div className="panel-box-head">
        <h3>{t.titulo}</h3>
        <Link href={volver} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
          Cerrar
        </Link>
      </div>
      <div className="panel-box-body" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge b-dark mono">
            {diaEnZona(new Date(t.inicia), zona)} · {horaEnZona(new Date(t.inicia), zona)}
            {' a '}
            {horaEnZona(new Date(t.termina), zona)}
          </span>
          <span className={`badge ${est.badge}`}>{est.label}</span>
          {t.creadoPorIa && <span className="badge b-blue">La agendó la IA</span>}
          {t.tipo ? <span className="badge b-gray">{t.tipo}</span> : null}
        </div>

        <div className="tiny muted">
          {t.contacto ? (
            t.conversationId ? (
              <Link href={`/bandeja/${t.conversationId}`}>{t.contacto}</Link>
            ) : (
              t.contacto
            )
          ) : (
            'Sin contacto'
          )}
          {t.telefono ? ` · ${t.telefono}` : ''}
          {t.creadoPor ? ` · lo cargó ${t.creadoPor}` : ''}
        </div>

        {t.notas ? <p style={{ fontSize: 13.5 }}>{t.notas}</p> : null}

        <div className="field" style={{ maxWidth: 280 }}>
          <label htmlFor={`resp-${t.id}`}>A cargo de</label>
          {puedeAsignar ? (
            <form action={asignarTurno}>
              <input type="hidden" name="id" value={t.id} />
              <select
                id={`resp-${t.id}`}
                name="userId"
                className="select"
                defaultValue={t.responsableId ?? ''}
              >
                <option value="">Sin asignar</option>
                {usuarios
                  .filter((u) => !u.deshabilitado || u.id === t.responsableId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
              </select>
              <button type="submit" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
                Guardar
              </button>
            </form>
          ) : (
            <b>{t.responsable ?? 'Sin asignar'}</b>
          )}
        </div>

        <form action={moverTurno} style={{ display: 'grid', gap: 10 }}>
          <input type="hidden" name="id" value={t.id} />
          <div className="agenda-fila">
            <div className="field">
              <label htmlFor={`dia-${t.id}`}>Mover a</label>
              <input
                id={`dia-${t.id}`} name="dia" type="date" className="input" required
                defaultValue={diaEnZona(new Date(t.inicia), zona)}
              />
            </div>
            <div className="field">
              <label htmlFor={`desde-${t.id}`}>Desde</label>
              <input
                id={`desde-${t.id}`} name="desde" type="time" className="input" required
                defaultValue={horaEnZona(new Date(t.inicia), zona)}
              />
            </div>
            <div className="field">
              <label htmlFor={`hasta-${t.id}`}>Hasta</label>
              <input
                id={`hasta-${t.id}`} name="hasta" type="time" className="input"
                defaultValue={horaEnZona(new Date(t.termina), zona)}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-ghost btn-sm">Mover</button>
          </div>
        </form>

        <div className="agenda-acciones">
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
            <button type="submit" className="btn btn-ghost btn-sm">Eliminar</button>
          </form>
        </div>
      </div>
    </div>
  )
}

/** La lista de siempre: lo que hay que hacer, agrupado por día. */
function Lista({
  turnos,
  config,
  hoy,
  pasado,
  href,
}: {
  turnos: Turno[]
  config: { zona: string }
  hoy: string
  pasado: boolean
  href: (extra: Record<string, string | undefined>) => string
}) {
  const porDia = new Map<string, Turno[]>()
  for (const t of turnos) {
    const dia = diaEnZona(new Date(t.inicia), config.zona)
    porDia.set(dia, [...(porDia.get(dia) ?? []), t])
  }
  const dias = [...porDia.keys()].sort()
  if (pasado) dias.reverse()
  const enPie = turnos.filter((t) => t.estado === 'programada').length

  return (
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
            {pasado ? '' : 'Cargá el primero con «Nuevo turno».'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            {dias.map((dia) => (
              <div key={dia}>
                <div className="agenda-dia">{rotuloDeDia(dia, hoy, config.zona)}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {(porDia.get(dia) ?? []).map((t) => {
                    const est = ESTADOS[t.estado] ?? ESTADOS.programada!
                    return (
                      <Link key={t.id} href={href({ turno: t.id })} className="agenda-turno">
                        <span className="agenda-hora mono">
                          {horaEnZona(new Date(t.inicia), config.zona)}
                          <small>{horaEnZona(new Date(t.termina), config.zona)}</small>
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 13.5 }}>{t.titulo}</strong>
                            <span className={`badge ${est.badge}`}>{est.label}</span>
                            {t.creadoPorIa && <span className="badge b-blue">La agendó la IA</span>}
                          </div>
                          <div className="tiny muted" style={{ marginTop: 3 }}>
                            {t.contacto ?? 'Sin contacto'}
                            {t.tipo ? ` · ${t.tipo}` : ''}
                            {' · '}
                            {t.responsable ?? 'sin responsable'}
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BotonEstado({ id, estado, texto }: { id: string; estado: string; texto: string }) {
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

/** El mismo día del mes de al lado, sin caerse del 31 al 3 de marzo. */
function mesVecino(dia: string, n: number): string {
  const [a, m] = dia.split('-').map(Number)
  const f = new Date(Date.UTC(a!, m! - 1 + n, 1))
  const nuevo = f.toISOString().slice(0, 7)
  const tope = diasDelMes(`${nuevo}-01`)
  return `${nuevo}-${String(Math.min(Number(dia.slice(8)), tope)).padStart(2, '0')}`
}

function tituloDe(v: Vista, ancla: string, dias: string[], zona: string): string {
  const fmt = (dia: string, opts: Intl.DateTimeFormatOptions) => {
    const [a, m, d] = dia.split('-').map(Number)
    return new Intl.DateTimeFormat('es-AR', { timeZone: zona, ...opts }).format(
      new Date(Date.UTC(a!, m! - 1, d!, 12)),
    )
  }
  if (v === 'mes') return fmt(ancla, { month: 'long', year: 'numeric' })
  if (v === 'dia') return fmt(ancla, { weekday: 'long', day: 'numeric', month: 'long' })
  const a = dias[0]!
  const b = dias[6]!
  return `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short' })}`
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
