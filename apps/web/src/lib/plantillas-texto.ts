/**
 * El texto de una plantilla con sus huecos completados.
 *
 * Vive en su propio archivo, SIN `server-only`, porque lo usan los dos lados:
 * el servidor para armar lo que se manda, y el compositor —que es un
 * componente de cliente— para la vista previa. Puesto en `plantillas.ts`
 * arrastraba todo el módulo del servidor al navegador y el build fallaba con
 * un "estás importando algo que depende de next/headers".
 *
 * Es la misma razón por la que `planes.ts` y `ai/models.ts` tampoco la tienen.
 */

/** Cuántos {{n}} distintos tiene un texto. */
export function huecosDe(texto: string): number {
  const vistos = new Set<string>()
  for (const m of texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) vistos.add(m[1]!)
  return vistos.size
}

/**
 * Reemplaza los huecos por sus valores.
 *
 * Un hueco sin completar queda a la vista como `{{1}}` en vez de vacío: que
 * se note lo que falta es justamente el punto de una vista previa.
 */
export function conValores(cuerpo: string, valores: string[]): string {
  return cuerpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (entero, n: string) => {
    const v = valores[Number(n) - 1]
    return v && v.trim() ? v : entero
  })
}
