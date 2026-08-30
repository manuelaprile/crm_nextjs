'use client'

import { useRef, type ReactNode } from 'react'
import { IconPersona, IconChevron } from '@/components/icons'

/**
 * El filtro de "Responsable", debajo de las solapas.
 *
 * Va en su propia fila y ocupa todo el ancho, no como una solapa más: no
 * filtra lo mismo que las de arriba —una persona puede ser responsable de un
 * hilo que hoy contesta la IA— y se combina con ellas. Puestos en la misma
 * fila parecían cinco opciones excluyentes.
 *
 * Es un `<details>` —el navegador ya sabe abrirlo y cerrarlo— pero elegir una
 * opción no recarga la página: navega del lado del cliente, y el elemento
 * sobrevive a la navegación con su `open` puesto. Resultado: quedaba abierto
 * tapando la lista hasta que lo cerrabas a mano.
 *
 * Cerrarlo al elegir es lo único que necesita cliente. Las opciones siguen
 * siendo enlaces del servidor: entran como `children` y no cruzan el límite.
 */
export function MenuResponsable({
  rotulo,
  activo,
  children,
}: {
  rotulo: string
  activo: boolean
  children: ReactNode
}) {
  const caja = useRef<HTMLDetailsElement>(null)

  return (
    <details ref={caja} className="wa-quien">
      <summary className={`wa-quien-btn${activo ? ' on' : ''}`}>
        <IconPersona />
        <span className="wa-quien-rotulo">
          Responsable: <b>{rotulo}</b>
        </span>
        <IconChevron className="wa-quien-flecha" />
      </summary>
      {/* Todo lo que hay adentro son enlaces: cualquier clic es una elección. */}
      <div
        className="wa-quien-panel"
        onClick={() => {
          if (caja.current) caja.current.open = false
        }}
      >
        {children}
      </div>
    </details>
  )
}
