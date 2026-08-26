'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'

/**
 * El latido del panel, en un solo lugar.
 *
 * Antes esto vivía adentro de la bandeja y el número de sin leer lo calculaba
 * el servidor y bajaba como prop al menú. Eso tenía tres consecuencias que se
 * notaban todo el tiempo:
 *
 *  - **El número no se actualizaba nunca sin recargar.** `router.refresh()`
 *    vuelve a correr la página, pero no el layout que lo contiene: el prop
 *    quedaba congelado con el valor del último F5.
 *  - **El aviso se perdía al navegar.** Al vivir adentro de la bandeja, se
 *    montaba y desmontaba en cada cambio de pantalla, y con él el estado de
 *    qué mensaje ya se había avisado.
 *  - **Se refrescaba de más.** Pedía un refresh completo aunque la persona
 *    estuviera en Contactos, donde no cambia nada, y eso hacía sentir la
 *    navegación pesada.
 *
 * Ahora hay un solo latido para todo el panel, montado en el layout, que no
 * se desmonta al navegar. El menú, el título de la pestaña y el aviso leen
 * todos de acá, así que muestran siempre lo mismo y se actualizan juntos.
 */

/**
 * Cada cuánto se pregunta si pasó algo.
 *
 * Medido: el latido cuesta 16ms de punta a punta y la consulta en sí 0,7ms
 * —son dos lecturas de la punta de un índice y una suma—. Con ese costo, los
 * cinco segundos que había antes no se justificaban: hacían esperar 2,5
 * segundos de promedio a que apareciera un mensaje, por nada.
 *
 * Va adaptativo. Rápido mientras hay actividad, que es cuando alguien está
 * mirando la pantalla esperando una respuesta; lento cuando hace rato que no
 * pasa nada, para no consultar 1.800 veces por hora una bandeja dormida.
 */
const RAPIDO_MS = 1_500
const LENTO_MS = 8_000
/** Cuántas vueltas sin novedad antes de aflojar. ~40s a ritmo rápido. */
const VUELTAS_HASTA_AFLOJAR = 25

const AVISO_MS = 10_000
/** Qué mensaje se avisó por última vez. Por pestaña. */
const CLAVE_VISTO = 'crm:ultimo-aviso'

type Ultimo = {
  id: string
  conversacionId: string
  quien: string
  texto: string
}

type Latido = { marca: string; sinLeer: number; ultimo: Ultimo | null }

type Estado = {
  sinLeer: number
  /** Vuelve a preguntar YA, sin esperar el ciclo. */
  refrescar: () => void
}

const Ctx = createContext<Estado | null>(null)

/**
 * El número de mensajes sin leer, en vivo.
 *
 * Devuelve `null` mientras no haya llegado el primer latido, para que quien
 * lo use pueda seguir mostrando el valor que pintó el servidor y no haya un
 * parpadeo en cero al cargar la página.
 */
export function useSinLeer(): number | null {
  return useContext(Ctx)?.sinLeer ?? null
}

/** Para pedir un latido inmediato después de una acción que cambia el estado. */
export function useRefrescarPulso(): () => void {
  const ctx = useContext(Ctx)
  return ctx?.refrescar ?? (() => {})
}

export function PulsoProvider({
  children,
  /** Lo que calculó el servidor en esta carga. Solo para el primer pintado. */
  sinLeerInicial,
}: {
  children: React.ReactNode
  sinLeerInicial: number
}) {
  const router = useRouter()
  const ruta = usePathname()
  const [sinLeer, setSinLeer] = useState(sinLeerInicial)
  const [aviso, setAviso] = useState<Ultimo | null>(null)

  const ultimaMarca = useRef<string | null>(null)
  /** Vueltas seguidas sin que cambie nada. Decide el ritmo. */
  const quietas = useRef(0)
  const ultimoVisto = useRef<string | null>(null)
  const enBandeja = useRef(false)
  const rutaActual = useRef(ruta)
  rutaActual.current = ruta
  enBandeja.current = ruta.startsWith('/bandeja')

  // Un disparador manual: cambiarlo fuerza una consulta inmediata.
  const [ahora, setAhora] = useState(0)
  const refrescar = useCallback(() => setAhora((n) => n + 1), [])

  useEffect(() => {
    try {
      ultimoVisto.current = sessionStorage.getItem(CLAVE_VISTO)
    } catch {
      /* almacenamiento bloqueado: se sigue solo en memoria */
    }
  }, [])

  useEffect(() => {
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let cierre: ReturnType<typeof setTimeout> | undefined

    async function mirar() {
      if (!vivo) return
      if (document.visibilityState !== 'visible') {
        // Con la pestaña oculta no se consulta, pero se sigue mirando de
        // tanto en tanto por si vuelve sin disparar el evento.
        timer = setTimeout(mirar, LENTO_MS)
        return
      }
      try {
        const res = await fetch('/api/bandeja/pulso', { cache: 'no-store' })
        if (res.status === 401) {
          // Sesión vencida: se corta. Insistir cada cinco segundos contra un
          // 401 no arregla nada y llena el registro del servidor.
          vivo = false
          return
        }
        if (res.ok) {
          const d = (await res.json()) as Latido
          setSinLeer(d.sinLeer)

          // El refresh solo donde se ve el contenido. Pedirlo estando en
          // Contactos o en Configuración es trabajo de servidor que nadie
          // mira, y es lo que hacía sentir pesada la navegación.
          if (
            ultimaMarca.current !== null &&
            ultimaMarca.current !== d.marca &&
            enBandeja.current
          ) {
            router.refresh()
          }
          // Cualquier novedad devuelve el ritmo rápido: si acaba de entrar un
          // mensaje, lo más probable es que entre otro enseguida.
          if (ultimaMarca.current !== d.marca) quietas.current = 0
          else quietas.current += 1
          ultimaMarca.current = d.marca

          const esNuevo =
            ultimoVisto.current !== null &&
            d.ultimo &&
            d.ultimo.id !== ultimoVisto.current &&
            // No se avisa de la conversación que la persona está mirando.
            rutaActual.current !== `/bandeja/${d.ultimo.conversacionId}`

          if (esNuevo && d.ultimo) {
            setAviso(d.ultimo)
            clearTimeout(cierre)
            cierre = setTimeout(() => setAviso(null), AVISO_MS)
          }
          if (d.ultimo) {
            ultimoVisto.current = d.ultimo.id
            try {
              sessionStorage.setItem(CLAVE_VISTO, d.ultimo.id)
            } catch {
              /* sin almacenamiento */
            }
          }
        }
      } catch {
        // Un latido perdido no es un error: el servidor puede estar
        // reiniciando. Se reintenta en la próxima vuelta.
      }
      if (vivo) {
        const espera =
          quietas.current >= VUELTAS_HASTA_AFLOJAR ? LENTO_MS : RAPIDO_MS
        timer = setTimeout(mirar, espera)
      }
    }

    // Enseguida, no a los cinco segundos. Al entrar a una conversación se
    // marca leída del lado del servidor, y sin esta consulta inmediata el
    // número del menú se quedaba viejo hasta el siguiente ciclo — que es lo
    // que se sentía como "tengo que pasar por varias pantallas para que se
    // borre".
    void mirar()

    const alVolver = () => {
      if (document.visibilityState === 'visible') {
        // Volver a la pestaña es señal de que hay alguien: se arranca rápido.
        quietas.current = 0
        clearTimeout(timer)
        void mirar()
      }
    }
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      vivo = false
      clearTimeout(timer)
      clearTimeout(cierre)
      document.removeEventListener('visibilitychange', alVolver)
    }
    // `ruta` está a propósito: cada navegación pide un latido inmediato.
  }, [router, ruta, ahora])

  /**
   * El título de la pestaña. Es lo que ve alguien que tiene el CRM abierto
   * atrás mientras trabaja en otra cosa.
   *
   * La base se vuelve a deducir en cada pasada sacándole el "(N) " de
   * adelante, en vez de guardarla al montar. Guardada, quedaba pegada al
   * título de la primera pantalla y al navegar a otra el contador le ponía el
   * prefijo al título equivocado. Deducirla siempre se auto-corrige: si el
   * prefijo lo pusimos nosotros se lo saca, y si el título lo cambió Next al
   * navegar, toma el nuevo.
   */
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = sinLeer > 0 ? `(${sinLeer}) ${base}` : base
  }, [sinLeer, ruta])

  return (
    <Ctx.Provider value={{ sinLeer, refrescar }}>
      {children}
      {aviso && (
        <Link
          href={`/bandeja/${aviso.conversacionId}`}
          onClick={() => setAviso(null)}
          className="aviso"
          // La barrita de tiempo se consume exactamente lo que dura el
          // cartel. Si algún día se cambia AVISO_MS, la animación acompaña
          // sola en vez de quedar desfasada.
          style={{ '--aviso-ms': `${AVISO_MS}ms` } as React.CSSProperties}
        >
          <span className="aviso-inicial" aria-hidden>
            {aviso.quien.trim().charAt(0) || '?'}
          </span>
          <span className="aviso-cuerpo">
            <span className="aviso-titulo">Mensaje nuevo</span>
            <div className="aviso-quien">{aviso.quien}</div>
            <div className="aviso-texto">{aviso.texto}</div>
          </span>
        </Link>
      )}
    </Ctx.Provider>
  )
}
