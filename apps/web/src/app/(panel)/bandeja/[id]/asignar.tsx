'use client'

import { useRef } from 'react'
import { derivarConversacion } from '@/lib/asignacion-acciones'
import type { UsuarioAsignable } from '@/lib/asignacion'

/**
 * Asignar la conversación a alguien del equipo.
 *
 * Elegir en la lista ya la asigna: no hay un "Guardar" que confirme algo que
 * ya se decidió. Es lo único de esta pantalla que necesita cliente, y por eso
 * es un componente aparte y no arrastra al resto del chat al navegador.
 *
 * Sin JavaScript el cambio no se manda solo, así que ahí —y solo ahí—
 * aparece el botón.
 */
export function AsignarConversacion({
  conversationId,
  asignadoA,
  usuarios,
}: {
  conversationId: string
  asignadoA: string | null
  usuarios: UsuarioAsignable[]
}) {
  const form = useRef<HTMLFormElement>(null)

  return (
    <form ref={form} action={derivarConversacion}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <select
        name="userId"
        className="select"
        style={{ width: '100%' }}
        defaultValue={asignadoA ?? ''}
        onChange={() => form.current?.requestSubmit()}
      >
        <option value="">Sin asignar</option>
        {usuarios
          // Alguien sin acceso no puede recibir un hilo nuevo, pero si ya lo
          // tenía sigue en la lista: sacarlo de acá se lo quitaría sin querer.
          .filter((u) => !u.deshabilitado || u.id === asignadoA)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
              {u.deshabilitado ? ' (sin acceso)' : ''}
            </option>
          ))}
      </select>
      <noscript>
        <button
          type="submit"
          className="btn btn-ghost btn-sm btn-block"
          style={{ marginTop: 8 }}
        >
          Asignar
        </button>
      </noscript>
    </form>
  )
}
