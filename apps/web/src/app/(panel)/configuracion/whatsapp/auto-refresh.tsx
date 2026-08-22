'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Refresca la pantalla mientras WhatsApp está negociando la conexión.
 *
 * El QR lo genera el worker de forma asincrónica y lo escribe en la base: la
 * página no puede saber cuándo apareció. Sin esto, el usuario aprieta
 * "Conectar", no ve nada, y concluye que el botón está roto.
 *
 * Solo corre en los estados transitorios. Cuando conecta o falla, para: no
 * tiene sentido machacar la base cada 3 segundos para siempre.
 */
export function AutoRefresh({ activo }: { activo: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (!activo) return
    const id = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(id)
  }, [activo, router])

  return null
}
