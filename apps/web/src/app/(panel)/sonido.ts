/**
 * El sonido de mensaje nuevo, generado en el momento.
 *
 * No hay archivo de audio. Se sintetizan dos notas cortas con la API de audio
 * del navegador, y eso resuelve de una varias cosas: no hay un binario en el
 * repositorio, no hay nada que servir ni cachear, no hay una petición más al
 * abrir el panel, y la política de contenido no tiene que permitir ningún
 * origen nuevo. Son unas líneas de código contra un .mp3 que habría que
 * versionar y mantener.
 *
 * Dos notas ascendentes y breves, con la ganancia bajando en curva: suena a
 * aviso y no a alarma. Alguien que atiende un consultorio lo va a escuchar
 * cincuenta veces por día.
 */

const CLAVE = 'crm:sonido-aviso'

/**
 * El contexto se crea una sola vez y se reusa.
 *
 * Crear uno por cada aviso los va acumulando: los navegadores permiten unos
 * pocos por pestaña y después fallan en silencio, así que a la vigésima
 * notificación dejaría de sonar sin ningún error.
 */
let ctx: AudioContext | null = null

function contexto(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AC) return null
    ctx ??= new AC()
    return ctx
  } catch {
    return null
  }
}

/** Si el aviso tiene que sonar. Prendido salvo que lo hayan apagado. */
export function sonidoActivo(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== 'no'
  } catch {
    // Almacenamiento bloqueado: se asume prendido, que es lo que la persona
    // pidió al configurarlo. Lo peor que pasa es que no se recuerde.
    return true
  }
}

export function guardarSonido(activo: boolean): void {
  try {
    localStorage.setItem(CLAVE, activo ? 'si' : 'no')
  } catch {
    /* sin almacenamiento: vale para esta sesión y nada más */
  }
}

/**
 * Suena. Nunca lanza y nunca bloquea.
 *
 * Los navegadores no dejan reproducir audio hasta que la persona interactuó
 * con la página. Si todavía no pasó, el contexto está suspendido: se intenta
 * despertarlo y, si no se puede, no suena y listo. Un aviso mudo es un
 * problema menor; una excepción en el medio del latido rompería el aviso
 * visual, que es el que importa.
 */
export function sonar(): void {
  if (!sonidoActivo()) return
  const ac = contexto()
  if (!ac) return

  const emitir = () => {
    try {
      const t0 = ac.currentTime
      // Dos notas: La5 y Do#6. Un intervalo alegre y corto.
      for (const [i, hz] of [880, 1108.73].entries()) {
        const osc = ac.createOscillator()
        const vol = ac.createGain()
        // Seno: sin armónicos ásperos. Una onda cuadrada acá sería un pitido.
        osc.type = 'sine'
        osc.frequency.value = hz
        const inicio = t0 + i * 0.11
        // Ataque muy corto y caída exponencial: golpe limpio, sin cola.
        vol.gain.setValueAtTime(0.0001, inicio)
        vol.gain.exponentialRampToValueAtTime(0.14, inicio + 0.012)
        vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.22)
        osc.connect(vol).connect(ac.destination)
        osc.start(inicio)
        osc.stop(inicio + 0.24)
      }
    } catch {
      /* que no suene no puede romper nada */
    }
  }

  if (ac.state === 'suspended') {
    ac.resume().then(emitir, () => {})
    return
  }
  emitir()
}
