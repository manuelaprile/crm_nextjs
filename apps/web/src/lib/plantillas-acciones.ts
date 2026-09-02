'use server'

/**
 * Crear una plantilla y mandarla a aprobar a Meta, sin salir del panel.
 *
 * El cliente nunca ve Zernio: escribe acá, nosotros llamamos a su API, y Meta
 * responde con el estado. Es lo que hace que el producto se pueda revender
 * con otra marca.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cuentaZernioDelTenant } from './plantillas'
import { crearPlantilla } from './zernio'
import { huecosDe } from './plantillas-texto'

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(`/plantillas?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 220))}`)
}

/**
 * El nombre que exige Meta: minúsculas, números y guiones bajos. Nada más.
 *
 * Se normaliza en vez de rechazar. Quien escribe "Promo Septiembre" no está
 * equivocándose: no tiene por qué conocer una regla de Meta. Se convierte a
 * `promo_septiembre` y se le muestra cómo quedó.
 */
export async function nombreDePlantilla(texto: string): Promise<string> {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

export async function crearPlantillaAccion(formData: FormData): Promise<void> {
  const accountId = await cuentaZernioDelTenant()
  if (!accountId) {
    volver(
      'error',
      'Primero hay que conectar el número por la vía oficial: las plantillas ' +
        'viven en la cuenta de WhatsApp del negocio.',
    )
  }

  const nombre = await nombreDePlantilla(String(formData.get('nombre') ?? ''))
  const cuerpo = String(formData.get('cuerpo') ?? '').trim()
  const idioma = String(formData.get('idioma') ?? 'es_AR')

  if (!nombre) volver('error', 'Poné un nombre para la plantilla.')
  if (!cuerpo) volver('error', 'La plantilla necesita un texto.')
  if (cuerpo.length > 1024) {
    volver('error', 'El texto de una plantilla no puede pasar los 1024 caracteres.')
  }
  if (!/^(es|es_AR|es_ES|es_MX|en|en_US|pt_BR)$/.test(idioma)) {
    volver('error', 'Idioma no soportado.')
  }

  // Los huecos tienen que ser 1, 2, 3… sin saltos. Meta rechaza {{1}} y {{3}}
  // sin {{2}}, y ese rechazo tarda horas en volver: mejor decirlo ahora.
  const numeros = [...cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) =>
    Number(m[1]),
  )
  const distintos = [...new Set(numeros)].sort((a, b) => a - b)
  const seguidos = distintos.every((n, i) => n === i + 1)
  if (!seguidos) {
    volver(
      'error',
      'Los huecos tienen que ir en orden y sin saltos: {{1}}, {{2}}, {{3}}…',
    )
  }
  if (huecosDe(cuerpo) > 10) {
    volver('error', 'Diez huecos es el máximo razonable para una plantilla.')
  }

  const r = await crearPlantilla({
    accountId,
    nombre,
    idioma,
    // Una campaña es MARKETING siempre. UTILITY es para lo que responde a
    // algo que la persona pidió —un turno, un envío— y usarla para promoción
    // es motivo de rechazo, o peor, de que Meta recategorice la cuenta.
    categoria: 'MARKETING',
    cuerpo,
  })

  if (!r.ok) {
    volver('error', `Meta no la aceptó: ${r.error}`)
  }

  revalidatePath('/plantillas')
  volver(
    'ok',
    `«${nombre}» se mandó a aprobar. Meta suele tardar entre unos minutos y ` +
      'un día; mientras tanto figura como pendiente.',
  )
}
