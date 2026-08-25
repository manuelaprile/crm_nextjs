'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

/** Cada cuánto se pregunta si entró algo. */
const CADA_MS = 5_000
/** Cuánto queda el cartelito antes de irse solo. */
const AVISO_MS = 12_000
/** Dónde se recuerda el último mensaje avisado, para sobrevivir a un remonte. */
const CLAVE_VISTO = 'crm:ultimo-aviso'

type Ultimo = {
  id: string
  conversacionId: string
  quien: string
  texto: string
}

type Latido = { marca: string; sinLeer: number; ultimo: Ultimo | null }

/**
 * Hace que un mensaje nuevo aparezca solo, y que se note.
 *
 * Dos cosas distintas:
 *
 *  1. **Refrescar.** Pregunta por una marca chica y, cuando cambia, pide un
 *     `router.refresh()`. El refresh de Next vuelve a correr los componentes
 *     de servidor y parchea el árbol de React: NO recarga el documento, así
 *     que lo que la persona esté escribiendo no se pierde.
 *
 *  2. **Avisar.** Cambia el título de la pestaña y muestra un cartel abajo a
 *     la derecha. Sin esto, alguien con la pestaña en segundo plano —que es
 *     como se usa un CRM— no se entera de que un paciente escribió hasta que
 *     vuelve a mirar.
 *
 * Se apaga cuando la pestaña no está a la vista para no consultar la base
 * todo el día, y al volver se consulta enseguida.
 */
export function Pulso({
  /**
   * La conversación abierta, si hay una. No se avisa de la que la persona
   * está mirando: ya la está viendo, y un cartel tapándola es estorbo.
   */
  conversacionAbierta,
}: {
  conversacionAbierta?: string
}) {
  const router = useRouter()
  const [aviso, setAviso] = useState<Ultimo | null>(null)

  // La marca de la última vez. Empieza vacía a propósito: la primera
  // respuesta solo la registra, sin refrescar ni avisar, porque la pantalla
  // recién se dibujó y esos mensajes no son nuevos para quien la abrió.
  const ultimaMarca = useRef<string | null>(null)
  /**
   * El último mensaje del que ya avisamos.
   *
   * Vive en `sessionStorage` y no solo en memoria porque este componente se
   * vuelve a montar al navegar entre la lista y una conversación. Con la
   * referencia solo en memoria, cada navegación la dejaba en null, la vuelta
   * siguiente se trataba como "primera vez" y el aviso no salía — que es
   * exactamente el síntoma de "la ventanita no aparece".
   *
   * `sessionStorage` y no `localStorage`: es de esta pestaña. Otra pestaña
   * tiene que poder avisar por su cuenta.
   */
  const ultimoVisto = useRef<string | null>(null)
  const tituloOriginal = useRef<string>('')
  const abierta = useRef(conversacionAbierta)
  abierta.current = conversacionAbierta

  useEffect(() => {
    tituloOriginal.current = document.title
    try {
      ultimoVisto.current = sessionStorage.getItem(CLAVE_VISTO)
    } catch {
      // Navegador con el almacenamiento bloqueado: se sigue sin él. El aviso
      // se pierde al navegar, pero nada más se rompe.
    }
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let ocultar: ReturnType<typeof setTimeout> | undefined

    async function mirar() {
      if (!vivo) return
      try {
        if (document.visibilityState === 'visible') {
          const res = await fetch('/api/bandeja/pulso', { cache: 'no-store' })
          // Sesión vencida: se deja de latir. Insistir cada cinco segundos
          // contra un 401 no arregla nada y llena el registro.
          if (res.status === 401) {
            vivo = false
            return
          }
          if (res.ok) {
            const d = (await res.json()) as Latido
            const primeraVez = ultimaMarca.current === null

            if (!primeraVez && ultimaMarca.current !== d.marca) {
              router.refresh()
            }

            // El aviso se dispara por el ID del último entrante, no por la
            // marca: la marca también cambia cuando mandamos nosotros, y
            // avisar de un mensaje propio no tiene ningún sentido.
            // Ya NO se exige `!primeraVez`: con el id recordado entre montes,
            // la primera consulta después de navegar sabe perfectamente si el
            // último entrante es uno del que ya avisamos o no.
            const esNuevo =
              ultimoVisto.current !== null &&
              d.ultimo &&
              d.ultimo.id !== ultimoVisto.current &&
              d.ultimo.conversacionId !== abierta.current

            if (esNuevo && d.ultimo) {
              setAviso(d.ultimo)
              clearTimeout(ocultar)
              ocultar = setTimeout(() => setAviso(null), AVISO_MS)
            }

            if (d.ultimo) {
              ultimoVisto.current = d.ultimo.id
              try {
                sessionStorage.setItem(CLAVE_VISTO, d.ultimo.id)
              } catch {
                /* sin almacenamiento, queda solo en memoria */
              }
            }
            ultimaMarca.current = d.marca
            marcarTitulo(d.sinLeer, d.ultimo, tituloOriginal.current)
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
      clearTimeout(ocultar)
      document.removeEventListener('visibilitychange', alVolver)
      document.title = tituloOriginal.current
    }
  }, [router])

  if (!aviso) return null

  return (
    <Link
      href={`/bandeja/${aviso.conversacionId}`}
      onClick={() => setAviso(null)}
      className="aviso"
    >
      <div className="aviso-quien">{aviso.quien}</div>
      <div className="aviso-texto">{aviso.texto}</div>
    </Link>
  )
}

/**
 * El título de la pestaña.
 *
 * Es lo que ve alguien que tiene el CRM en una pestaña de fondo mientras
 * trabaja en otra cosa, que es como se usa de verdad. El contador va
 * adelante para que se lea aunque el navegador recorte el título.
 */
function marcarTitulo(sinLeer: number, ultimo: Ultimo | null, original: string) {
  if (sinLeer > 0 && ultimo) {
    document.title = `(${sinLeer}) Nuevo mensaje de ${ultimo.quien}`
  } else if (sinLeer > 0) {
    document.title = `(${sinLeer}) ${original}`
  } else {
    document.title = original
  }
}
