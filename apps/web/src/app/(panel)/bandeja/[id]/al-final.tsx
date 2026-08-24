'use client'

import { useEffect, useRef } from 'react'

/**
 * Deja el hilo abierto en el último mensaje, como cualquier chat.
 *
 * Es un div vacío al final de la lista al que se le pide `scrollIntoView`.
 * Sin esto, una conversación de doscientos mensajes se abre en el más viejo y
 * hay que bajar a mano para ver lo que la persona acaba de escribir.
 *
 * `marca` cambia al saltar de conversación o al llegar un mensaje nuevo: es lo
 * que hace que vuelva a bajar en vez de quedarse donde estaba.
 */
export function AlFinal({ marca }: { marca: string }) {
  const ancla = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ancla.current?.scrollIntoView({ block: 'end' })
  }, [marca])

  return <div ref={ancla} aria-hidden />
}
