'use server'

/**
 * Datos del comercio: los que aparecen en el pie de las respuestas, en las
 * facturas y —sobre todo— los que el asistente necesita para contestar
 * "¿dónde quedan?" o "¿hasta qué hora atienden?" sin que nadie los haya
 * transcripto adentro del prompt.
 *
 * Igual que la configuración del asistente, las acciones REDIRIGEN con el
 * resultado en la query en vez de devolverlo por `useActionState`: así el
 * formulario sigue andando aunque el JavaScript del cliente no cargue. Ver
 * el comentario largo en ai-settings.ts.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { requireTenant, requireAdmin } from './auth'
import { withTenant } from './db/client'

export type Comercio = {
  /** Es `tenants.name`: el mismo que se ve arriba del menú. */
  nombre: string
  razonSocial: string
  cuit: string
  telefono: string
  whatsapp: string
  email: string
  direccion: string
  ciudad: string
  provincia: string
  codigoPostal: string
  horarios: string
  /** Momento de la última subida, para romper la caché del navegador. */
  logoVersion: string | null
  logoMime: string | null
}

const VACIO = (v: unknown) => (v == null ? '' : String(v))

export async function getComercio(): Promise<Comercio> {
  const session = await requireTenant()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select t.name,
             p.legal_name, p.tax_id, p.phone, p.whatsapp, p.email,
             p.address, p.city, p.province, p.postal_code, p.hours,
             p.logo_mime, p.logo_updated_at
        from tenants t
   left join tenant_profiles p on p.tenant_id = t.id
       where t.id = ${session.tenantId}
    `)
    const r = (res.rows[0] ?? {}) as Record<string, unknown>
    return {
      nombre: VACIO(r.name),
      razonSocial: VACIO(r.legal_name),
      cuit: VACIO(r.tax_id),
      telefono: VACIO(r.phone),
      whatsapp: VACIO(r.whatsapp),
      email: VACIO(r.email),
      direccion: VACIO(r.address),
      ciudad: VACIO(r.city),
      provincia: VACIO(r.province),
      codigoPostal: VACIO(r.postal_code),
      horarios: VACIO(r.hours),
      logoVersion: r.logo_updated_at
        ? String(new Date(String(r.logo_updated_at)).getTime())
        : null,
      logoMime: r.logo_mime ? String(r.logo_mime) : null,
    }
  })
}

function volver(tipo: 'ok' | 'error', msg: string): never {
  redirect(
    `/configuracion/comercio?r=${tipo}&m=${encodeURIComponent(msg.slice(0, 200))}`,
  )
}

/** Recorta y normaliza un campo de texto del formulario. */
function campo(fd: FormData, nombre: string, max = 200): string {
  return String(fd.get(nombre) ?? '').trim().slice(0, max)
}

export async function guardarComercio(formData: FormData): Promise<void> {
  const session = await requireAdmin()

  const nombre = campo(formData, 'nombre', 120)
  if (!nombre) volver('error', 'El nombre comercial no puede quedar vacío.')

  const email = campo(formData, 'email', 160).toLowerCase()
  if (email && !email.includes('@')) volver('error', 'El email no es válido.')

  const datos = {
    razonSocial: campo(formData, 'razonSocial', 160),
    cuit: campo(formData, 'cuit', 20),
    telefono: campo(formData, 'telefono', 40),
    whatsapp: campo(formData, 'whatsapp', 40),
    direccion: campo(formData, 'direccion', 200),
    ciudad: campo(formData, 'ciudad', 80),
    provincia: campo(formData, 'provincia', 80),
    codigoPostal: campo(formData, 'codigoPostal', 20),
    horarios: campo(formData, 'horarios', 300),
  }

  await withTenant(session, async (tx) => {
    // El nombre vive en `tenants` porque es lo que ve todo el sistema (el
    // menú, la vista de plataforma, el prompt). No se duplica acá.
    await tx.execute(sql`
      update tenants set name = ${nombre} where id = ${session.tenantId}
    `)
    await tx.execute(sql`
      insert into tenant_profiles (
        tenant_id, legal_name, tax_id, phone, whatsapp, email,
        address, city, province, postal_code, hours
      ) values (
        ${session.tenantId}, ${datos.razonSocial}, ${datos.cuit},
        ${datos.telefono}, ${datos.whatsapp}, ${email},
        ${datos.direccion}, ${datos.ciudad}, ${datos.provincia},
        ${datos.codigoPostal}, ${datos.horarios}
      )
      on conflict (tenant_id) do update set
        legal_name = excluded.legal_name, tax_id = excluded.tax_id,
        phone = excluded.phone, whatsapp = excluded.whatsapp,
        email = excluded.email, address = excluded.address,
        city = excluded.city, province = excluded.province,
        postal_code = excluded.postal_code, hours = excluded.hours
    `)
    await tx.execute(sql`
      insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id)
      values (${session.tenantId}, ${session.userId}, 'comercio.updated',
              'tenant', ${session.tenantId})
    `)
  })

  // El nombre se ve en el menú de todas las pantallas.
  revalidatePath('/', 'layout')
  volver('ok', 'Datos guardados.')
}

const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const MAX_LOGO = 512 * 1024

export async function subirLogo(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const archivo = formData.get('logo')

  if (!(archivo instanceof File) || archivo.size === 0) {
    volver('error', 'Elegí un archivo.')
  }
  if (!TIPOS_LOGO.includes(archivo.type)) {
    volver('error', 'El logo tiene que ser PNG, JPG, WEBP o SVG.')
  }
  if (archivo.size > MAX_LOGO) {
    volver('error', 'El logo no puede pesar más de 512 KB.')
  }

  const bytes = Buffer.from(await archivo.arrayBuffer())

  await withTenant(session, async (tx) => {
    await tx.execute(sql`
      insert into tenant_profiles (tenant_id, logo_mime, logo_bytes, logo_updated_at)
      values (${session.tenantId}, ${archivo.type}, ${bytes}, now())
      on conflict (tenant_id) do update set
        logo_mime = excluded.logo_mime,
        logo_bytes = excluded.logo_bytes,
        logo_updated_at = now()
    `)
  })

  revalidatePath('/', 'layout')
  volver('ok', 'Logo actualizado.')
}

export async function quitarLogo(): Promise<void> {
  const session = await requireAdmin()
  await withTenant(session, (tx) =>
    tx.execute(sql`
      update tenant_profiles
         set logo_mime = null, logo_bytes = null, logo_updated_at = null
       where tenant_id = ${session.tenantId}
    `),
  )
  revalidatePath('/', 'layout')
  volver('ok', 'Logo quitado.')
}

/**
 * El logo para mostrar en el panel. Devuelve los bytes, no una URL: lo sirve
 * la ruta /api/marca/logo, que resuelve el tenant por la sesión.
 */
export async function leerLogo(): Promise<{ mime: string; bytes: Buffer } | null> {
  const session = await requireTenant()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select logo_mime, logo_bytes from tenant_profiles
       where tenant_id = ${session.tenantId} and logo_bytes is not null
    `)
    const r = res.rows[0] as Record<string, unknown> | undefined
    if (!r) return null
    return { mime: String(r.logo_mime), bytes: r.logo_bytes as Buffer }
  })
}

/**
 * Solo la fecha de la última subida, para el menú. Es una lectura por clave
 * primaria: sale más barato que traer los bytes en cada pantalla.
 */
export async function getLogoVersion(): Promise<string | null> {
  const session = await requireTenant()
  return withTenant(session, async (tx) => {
    const res = await tx.execute(sql`
      select logo_updated_at from tenant_profiles
       where tenant_id = ${session.tenantId} and logo_bytes is not null
    `)
    const r = res.rows[0] as Record<string, unknown> | undefined
    return r?.logo_updated_at
      ? String(new Date(String(r.logo_updated_at)).getTime())
      : null
  })
}
