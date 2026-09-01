/**
 * El mes que se está mirando, como texto.
 *
 * Sin directiva: no es `'use server'` —todo export ahí tiene que ser una
 * función async— ni `'server-only'`, porque son funciones puras que también
 * sirven en el navegador. Es el mismo motivo por el que `planes.ts` no la
 * tiene.
 *
 * `'2026-08'` es un mes; `null` es el histórico completo. Viaja como texto y
 * no como `Date` a propósito: es lo que va en la URL
 * (`/superadmin?mes=2026-08`) y las fronteras del mes las corta Postgres con
 * la zona horaria de la cuenta (`mes_desde` / `mes_en_curso`, migración
 * 0036). Un `Date` acá haría que el mes empezara en la zona del proceso de
 * Node y terminara en la de la base, con tres horas de diferencia.
 */
export type Mes = string | null

const FORMA = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * El mes que pide la URL. `'todo'` es el histórico; cualquier otra cosa que
 * no tenga forma de mes cae en el mes en curso.
 *
 * Se valida con una expresión regular y no se confía en el texto: va a parar
 * a un `::date` de Postgres, y una URL mal escrita tiene que dar la pantalla
 * de siempre, no un error.
 */
export function mesPedido(valor: string | undefined): Mes {
  if (valor === 'todo') return null
  return valor && FORMA.test(valor) ? valor : mesActual()
}

export function mesActual(): string {
  const hoy = new Date()
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Cómo se llama el período en pantalla: "Agosto 2026" o "Histórico".
 *
 * El `Date` se arma con el día 1 al MEDIODÍA. A las 00:00 un corrimiento de
 * zona de una hora tira la fecha al mes anterior, y el rótulo diría "julio"
 * arriba de los números de agosto.
 */
export function rotuloMes(mes: Mes): string {
  if (mes === null) return 'Histórico'
  const [a, m] = mes.split('-')
  const d = new Date(Number(a), Number(m) - 1, 1, 12)
  const txt = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

/** Lo mismo, para meter adentro de una frase. */
export function cuando(mes: Mes): string {
  return mes === null ? 'todo el histórico' : rotuloMes(mes).toLowerCase()
}
