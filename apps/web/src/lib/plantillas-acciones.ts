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
import { crearPlantilla, subirImagen } from './zernio'
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
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  // Meta además exige que EMPIECE CON LETRA: "2x1 de septiembre" quedaría en
  // `2x1_de_septiembre` y lo rechaza. Se le antepone una letra en vez de
  // devolver un error, que es lo mismo que hace el resto de la limpieza.
  return /^[a-z]/.test(limpio) ? limpio : `p_${limpio}`.slice(0, 60)
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
  const cuantos = huecosDe(cuerpo)
  if (cuantos > 10) {
    volver('error', 'Diez huecos es el máximo razonable para una plantilla.')
  }

  // Meta EXIGE un ejemplo por hueco. Sin ellos rechaza con un mensaje de
  // formato genérico que habla de la sintaxis de las variables y no menciona
  // el ejemplo, así que sin esta validación el rechazo llega horas después y
  // apuntando al lugar equivocado.
  const ejemplos = formData
    .getAll('ejemplo')
    .map((v) => String(v).trim().slice(0, 120))
    .slice(0, cuantos)
  if (ejemplos.length < cuantos || ejemplos.some((e) => !e)) {
    volver(
      'error',
      'Falta un ejemplo para cada dato variable. Meta los pide para poder ' +
        'aprobar la plantilla.',
    )
  }

  // ---- La imagen del encabezado, si la hay -------------------------
  // Se sube ANTES de crear la plantilla: Meta necesita una muestra que pueda
  // leer para aprobarla, y esa muestra es una URL pública.
  let imagenUrl: string | null = null
  const archivo = formData.get('imagen')
  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > 5 * 1024 * 1024) {
      volver('error', 'La imagen no puede pasar de 5 MB.')
    }
    if (!['image/jpeg', 'image/png'].includes(archivo.type)) {
      volver('error', 'La imagen tiene que ser JPG o PNG.')
    }
    const subida = await subirImagen({
      accountId,
      nombre: archivo.name || 'muestra.jpg',
      contentType: archivo.type,
      bytes: Buffer.from(await archivo.arrayBuffer()),
    })
    if (!subida.ok) volver('error', `No se pudo subir la imagen: ${subida.error}`)
    imagenUrl = subida.data.url
  }

  const r = await crearPlantilla({
    accountId,
    nombre,
    idioma,
    ejemplos,
    imagenUrl,
    // Una campaña es MARKETING siempre. UTILITY es para lo que responde a
    // algo que la persona pidió —un turno, un envío— y usarla para promoción
    // es motivo de rechazo, o peor, de que Meta recategorice la cuenta.
    categoria: 'MARKETING',
    cuerpo,
  })

  if (!r.ok) {
    // El texto crudo de Meta va entero: es lo único que dice qué corregir.
    // Los dos rechazos más comunes se traducen, porque el original no se
    // entiende sin saber cómo se llaman las cosas del otro lado.
    const crudo = r.error
    const claro = /already exists|duplicate/i.test(crudo)
      ? 'Ya existe una plantilla con ese nombre. Poné otro.'
      : /discriminator|component/i.test(crudo)
        ? 'El formato del mensaje no fue aceptado. Probá con un texto simple, sin encabezado ni botones.'
        : /invalid format|variable syntax/i.test(crudo)
          ? 'Meta no aceptó el formato. Suele ser por los huecos: tienen que ' +
            'ir {{1}}, {{2}} en orden, no pueden quedar al principio ni al ' +
            'final del texto, y el mensaje no puede terminar con renglones ' +
            'en blanco.'
          : crudo
    volver('error', `No se pudo crear: ${claro}`)
  }

  revalidatePath('/plantillas')
  volver(
    'ok',
    `«${nombre}» se mandó a aprobar${imagenUrl ? ', con imagen' : ''}. Meta ` +
      'suele tardar entre unos minutos y un día; mientras tanto figura como ' +
      'pendiente.',
  )
}
