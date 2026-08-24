import { requireTenant } from '@/lib/auth'
import {
  listarEtapas,
  crearEtapa,
  renombrarEtapa,
  marcarEtapa,
  moverEtapa,
  borrarEtapa,
} from '@/lib/etapas'

export const dynamic = 'force-dynamic'

const PAPELES = [
  { valor: 'normal', label: 'Paso intermedio' },
  { valor: 'inicial', label: 'Entrada (donde caen los nuevos)' },
  { valor: 'ganada', label: 'Cierre (el objetivo)' },
  { valor: 'perdida', label: 'Descarte' },
]

/**
 * Las etapas del embudo, editables.
 *
 * Un consultorio y una inmobiliaria no tienen los mismos estados —"Se operó"
 * no significa nada para quien alquila departamentos— y el sistema nunca los
 * tuvo fijos: viven en la tabla `stages`, una fila por etapa y por cuenta.
 * Lo que faltaba era la pantalla para tocarlos sin entrar a la base.
 */
export default async function EtapasPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  const { r, m } = await searchParams

  if (session.role === 'agent') {
    return (
      <div className="panel-box">
        <div className="empty">
          <b>Sin permisos</b>
          Solo el dueño o un administrador puede cambiar las etapas.
        </div>
      </div>
    )
  }

  const etapas = await listarEtapas()

  const papel = (e: (typeof etapas)[number]) =>
    e.esInicial ? 'inicial' : e.esGanada ? 'ganada' : e.esPerdida ? 'perdida' : 'normal'

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

      <div className="panel-box" style={{ marginBottom: 16 }}>
        <div className="panel-box-head">
          <div>
            <h3>Etapas del embudo</h3>
            <p className="tiny muted" style={{ marginTop: 3 }}>
              El recorrido de un contacto, de la primera consulta al cierre. El
              orden es el que se ve en el tablero y en el reporte.
            </p>
          </div>
        </div>

        <div className="panel-box-body" style={{ display: 'grid', gap: 10 }}>
          {etapas.map((e, i) => (
            <div key={e.id} className="etapa">
              <div className="etapa-orden">
                <form action={moverEtapa}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="hacia" value="arriba" />
                  <button
                    type="submit"
                    className="icon-btn"
                    disabled={i === 0}
                    aria-label={`Subir ${e.name}`}
                  >
                    ▲
                  </button>
                </form>
                <form action={moverEtapa}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="hacia" value="abajo" />
                  <button
                    type="submit"
                    className="icon-btn"
                    disabled={i === etapas.length - 1}
                    aria-label={`Bajar ${e.name}`}
                  >
                    ▼
                  </button>
                </form>
              </div>

              <form action={renombrarEtapa} className="etapa-nombre">
                <input type="hidden" name="id" value={e.id} />
                <input
                  type="color"
                  name="color"
                  defaultValue={e.color}
                  className="etapa-color"
                  aria-label={`Color de ${e.name}`}
                />
                <input
                  name="nombre"
                  defaultValue={e.name}
                  className="input"
                  maxLength={60}
                  required
                />
                <button type="submit" className="btn btn-ghost btn-sm">
                  Guardar
                </button>
              </form>

              <form action={marcarEtapa} className="etapa-papel">
                <input type="hidden" name="id" value={e.id} />
                <select
                  name="tipo"
                  defaultValue={papel(e)}
                  className="select"
                  aria-label={`Papel de ${e.name}`}
                >
                  {PAPELES.map((p) => (
                    <option key={p.valor} value={p.valor}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-ghost btn-sm">
                  Aplicar
                </button>
              </form>

              <div className="etapa-datos">
                <span className="tiny muted mono" title="Contactos parados acá">
                  {e.contactos}
                </span>
                <form action={borrarEtapa}>
                  <input type="hidden" name="id" value={e.id} />
                  <button
                    type="submit"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--c-danger)' }}
                  >
                    Borrar
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-box" style={{ marginBottom: 16 }}>
        <div className="panel-box-head">
          <h3>Agregar una etapa</h3>
        </div>
        <div className="panel-box-body">
          <form action={crearEtapa} className="etapa-nombre" style={{ maxWidth: 520 }}>
            <input
              type="color"
              name="color"
              defaultValue="#6b7280"
              className="etapa-color"
              aria-label="Color"
            />
            <input
              name="nombre"
              className="input"
              placeholder="Visita agendada"
              maxLength={60}
              required
            />
            <button type="submit" className="btn btn-primary btn-sm">
              Agregar
            </button>
          </form>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Se agrega al final. Después la ordenás con las flechas.
          </p>
        </div>
      </div>

      <div className="alert alert-gray">
        <span>
          <strong>Entrada</strong> es donde cae un contacto nuevo y hay una
          sola. <strong>Cierre</strong> es el objetivo del embudo —operarse,
          firmar, comprar— y también es una sola: es la que mide la conversión
          en Reportes. Las de <strong>descarte</strong> no cuentan para el
          embudo y puede haber varias. Una etapa por la que ya pasaron
          contactos se renombra, no se borra: borrarla se llevaría su
          historial y el reporte quedaría mal para siempre.
        </span>
      </div>
    </>
  )
}
