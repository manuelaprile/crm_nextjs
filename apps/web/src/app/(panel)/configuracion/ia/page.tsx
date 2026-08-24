import { requireTenant } from '@/lib/auth'
import { getAjustesIA } from '@/lib/ai-settings'
import { FormIA, type Aviso } from './form'

export const dynamic = 'force-dynamic'

/**
 * Los mensajes llegan por la query, no por estado del cliente: así el
 * formulario funciona aunque el JavaScript no cargue. Ver el comentario de
 * `lib/ai-settings.ts`.
 */
function leerAviso(r?: string, m?: string): { general: Aviso; prueba: Aviso } {
  const texto = m ?? ''
  if (r === 'ok') return { general: { tipo: 'ok', texto }, prueba: null }
  if (r === 'error') return { general: { tipo: 'error', texto }, prueba: null }
  if (r === 'prueba-ok') return { general: null, prueba: { tipo: 'ok', texto } }
  if (r === 'prueba-error')
    return { general: null, prueba: { tipo: 'error', texto } }
  return { general: null, prueba: null }
}

export default async function IAPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()

  if (session.role === 'agent') {
    return (
      <div className="panel-box">
        <div className="empty">
          <b>Sin permisos</b>
          Solo el dueño o un administrador puede configurar el asistente.
        </div>
      </div>
    )
  }

  const { r, m } = await searchParams
  const avisos = leerAviso(r, m)
  const ajustes = await getAjustesIA()

  return (
    <>
      <div className="page-head">
        <p style={{ marginTop: 0 }}>
          Responde el primer contacto, clasifica la consulta y deriva a la
          secretaria
        </p>
      </div>
      {ajustes ? (
        <FormIA
          inicial={ajustes}
          aviso={avisos.general}
          avisoPrueba={avisos.prueba}
        />
      ) : (
        <div className="alert alert-amber">
          Esta cuenta todavía no tiene configuración de asistente. Ejecutá{' '}
          <code>seed_vertical(tenant_id, rubro)</code> para crearla.
        </div>
      )}
    </>
  )
}
