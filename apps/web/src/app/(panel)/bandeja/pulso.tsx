'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/** Cada cuánto se pregunta si entró algo. */
const CADA_MS = 5_000

/**
 * Hace que un mensaje nuevo aparezca solo, sin recargar la página.
 *
 * Pregunta por una marca chica (`/api/bandeja/pulso`) y, cuando cambia,
 * pide un `router.refresh()`. El refresh de Next vuelve a correr los
 * componentes de servidor y parchea el árbol de React: NO recarga el
 * documento, así que lo que la persona esté escribiendo en el campo de
 * respuesta no se pierde y la lista no salta.
 *
 * Se apaga cuando la pestaña no está a la vista. Una bandeja abierta y
 * olvidada en otra ventana no tiene por qué seguir consultando la base todo
 * el día, y al volver se consulta enseguida, así que no se pierde nada.
 */
export function Pulso() {
  const router = useRouter()
  // La marca de la última vez. Empieza vacía a propósito: la primera respuesta
  // solo la registra, sin refrescar, porque la pantalla recién se dibujó.
  const ultima = useRef<string | null>(null)

  useEffect(() => {
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | undefined

    async function mirar() {
      if (!vivo) return
      try {
        if (document.visibilityState === 'visible') {
          const res = await fetch('/api/bandeja/pulso', { cache: 'no-store' })
          if (res.ok) {
            const { marca } = (await res.json()) as { marca: string }
            if (ultima.current !== null && ultima.current !== marca) {
              router.refresh()
            }
            ultima.current = marca
          }
        }
      } catch {
        // Un latido perdido no es un error: puede ser el server reiniciando o
        // la conexión yendo y viniendo. Se reintenta en la próxima vuelta.
      }
      if (vivo) timer = setTimeout(mirar, CADA_MS)
    }

    // Encadenado con setTimeout y no con setInterval: si una consulta tarda,
    // con interval se apilarían pedidos encima de una base que ya está lenta.
    timer = setTimeout(mirar, CADA_MS)

    // Al volver a la pestaña se mira enseguida, sin esperar el ciclo.
    const alVolver = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer)
        void mirar()
      }
    }
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      vivo = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [router])

  return null
}
