'use client'

import { useEffect, useState } from 'react'
import { guardarSonido, sonar, sonidoActivo } from './sonido'

/**
 * Prender y apagar el sonido del aviso.
 *
 * Al PRENDERLO suena una vez, y eso hace dos cosas de una: confirma que el
 * sonido funciona en este equipo —no hay nada peor que un interruptor que
 * decís que prendiste y no sabés si anda— y despierta el audio del navegador,
 * que no deja reproducir nada hasta que la persona hizo clic en algo. Sin ese
 * clic, el primer mensaje que entrara sería mudo.
 */
export function BotonSonido() {
  // Arranca en null y no en true: el valor real vive en el navegador, y
  // pintarlo en el servidor daría un texto distinto al del cliente.
  const [activo, setActivo] = useState<boolean | null>(null)

  useEffect(() => {
    setActivo(sonidoActivo())
  }, [])

  if (activo === null) return null

  return (
    <button
      type="button"
      className="snav"
      style={{ marginTop: 4, fontSize: 13 }}
      aria-pressed={activo}
      onClick={() => {
        const nuevo = !activo
        setActivo(nuevo)
        guardarSonido(nuevo)
        if (nuevo) sonar()
      }}
    >
      {activo ? '🔔 Sonido activado' : '🔕 Sonido apagado'}
    </button>
  )
}
