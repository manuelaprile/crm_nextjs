'use client'

import { useRef, type ReactNode } from 'react'

/**
 * El desplegable de "Responsable" en la fila de filtros.
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
      <summary className={`chip${activo ? ' on' : ''}`}>
        Responsable: {rotulo}
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
