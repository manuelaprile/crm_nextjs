import { guardarTurno } from '@/lib/agenda-acciones'
import { comoSeLee, diaEnZona, horaEnZona } from '@/lib/horarios'
import { IconCalendar } from '@/components/icons'
import type { Turno } from '@/lib/agenda'

/**
 * Agendar sin salir de la conversación.
 *
 * Se abre con `<details>` y no con estado de React a propósito: es un
 * desplegable, el navegador ya sabe hacerlo, y así esta parte del chat sigue
 * siendo servidor. Un componente de cliente acá arrastraría el formulario
 * entero al navegador para ahorrarse un clic.
 *
 * Los datos vienen cargados —el contacto, la conversación, el día de hoy— que
 * es todo el punto: quien está atendiendo a alguien por WhatsApp no tiene por
 * qué ir a otra pantalla y volver a escribir de quién se trata.
 */
export function AgendarDesdeChat({
  conversationId,
  contactId,
  nombre,
  zona,
  proximo,
}: {
  conversationId: string
  contactId: string | null
  nombre: string
  zona: string
  /** Si ya tiene uno, se muestra en vez de ofrecer cargar otro a ciegas. */
  proximo: Turno | null
}) {
  const hoy = diaEnZona(new Date(), zona)

  return (
    <details className="agendar">
      <summary
        className="btn btn-ghost btn-sm agendar-boton"
        title={proximo ? 'Ver el turno' : 'Agendar un turno'}
      >
        <IconCalendar />
        {proximo ? (
          <span className="agendar-marca">
            {horaEnZona(new Date(proximo.inicia), zona)}
          </span>
        ) : null}
      </summary>

      <div className="agendar-panel">
        {proximo ? (
          <p className="tiny" style={{ margin: '0 0 12px' }}>
            Ya tiene un turno el{' '}
            <strong>{comoSeLee(new Date(proximo.inicia), zona)}</strong>
            {proximo.titulo ? ` · ${proximo.titulo}` : ''}.{' '}
            <a href="/agenda">Verlo en la agenda</a>
          </p>
        ) : null}

        <form action={guardarTurno} style={{ display: 'grid', gap: 10 }}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="contactId" value={contactId ?? ''} />
          <div className="field">
            <label htmlFor="ag-titulo">De qué es</label>
            <input
              id="ag-titulo"
              name="titulo"
              className="input"
              required
              maxLength={120}
              defaultValue={nombre ? `Turno de ${nombre}` : ''}
            />
          </div>
          <div className="agenda-fila">
            <div className="field">
              <label htmlFor="ag-dia">Día</label>
              <input id="ag-dia" name="dia" type="date" className="input"
                required defaultValue={hoy} />
            </div>
            <div className="field">
              <label htmlFor="ag-desde">Desde</label>
              <input id="ag-desde" name="desde" type="time" className="input" required />
            </div>
            <div className="field">
              <label htmlFor="ag-hasta">Hasta</label>
              <input id="ag-hasta" name="hasta" type="time" className="input" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ag-notas">Notas</label>
            <textarea id="ag-notas" name="notas" className="input" rows={2}
              maxLength={2000} />
          </div>
          <div>
            <button type="submit" className="btn btn-primary btn-sm">
              Agendar
            </button>
          </div>
        </form>
      </div>
    </details>
  )
}
