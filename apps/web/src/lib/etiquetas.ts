/**
 * Cómo se llama, en esta cuenta, la cosa que el sistema administra.
 *
 * El producto es el mismo para un consultorio, una inmobiliaria o un estudio
 * contable: cambia el rubro. El rótulo sale del catálogo `verticals` (ver
 * 0013_rubros.sql) y viaja en la sesión, así que ninguna pantalla necesita
 * consultar la base para saber si tiene que decir "consultorio" o
 * "inmobiliaria".
 *
 * En la vista de PLATAFORMA (superadmin, donde conviven rubros distintos) no
 * hay un rótulo único posible: ahí se usa "cuenta", que es lo neutro.
 */
export type Etiqueta = {
  /** "Consultorio" */
  singular: string
  /** "Consultorios" */
  plural: string
  /** 'el' | 'la' — el género, para armar las frases. */
  articulo: string
}

/** Lo que se usa cuando no hay cuenta activa o el rubro no tiene rótulo. */
export const ETIQUETA_NEUTRA: Etiqueta = {
  singular: 'Cuenta',
  plural: 'Cuentas',
  articulo: 'la',
}

export function etiquetaDe(sesion: {
  tenantSingular?: string | null
  tenantPlural?: string | null
  tenantArticulo?: string | null
} | null): Etiqueta {
  if (!sesion?.tenantSingular) return ETIQUETA_NEUTRA
  return {
    singular: sesion.tenantSingular,
    plural: sesion.tenantPlural ?? sesion.tenantSingular,
    articulo: sesion.tenantArticulo === 'la' ? 'la' : 'el',
  }
}

/** "el consultorio" / "la inmobiliaria" */
export function elRubro(e: Etiqueta): string {
  return `${e.articulo} ${e.singular.toLowerCase()}`
}

/** "del consultorio" / "de la inmobiliaria" */
export function delRubro(e: Etiqueta): string {
  return e.articulo === 'la'
    ? `de la ${e.singular.toLowerCase()}`
    : `del ${e.singular.toLowerCase()}`
}

/** "al consultorio" / "a la inmobiliaria" */
export function alRubro(e: Etiqueta): string {
  return e.articulo === 'la'
    ? `a la ${e.singular.toLowerCase()}`
    : `al ${e.singular.toLowerCase()}`
}
