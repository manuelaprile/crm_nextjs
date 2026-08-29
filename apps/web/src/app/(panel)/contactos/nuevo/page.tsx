import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { getStages } from '@/lib/queries'
import { funcionActiva } from '@/lib/funciones'
import { crearContacto } from '@/lib/contactos-acciones'
import { IconBack } from '@/components/icons'

export const dynamic = 'force-dynamic'

/**
 * Cargar un contacto a mano.
 *
 * Detrás del interruptor `alta-manual-contactos`, apagado por defecto: con
 * el interruptor cerrado esta ruta no existe, no es que esconda el botón.
 * La acción vuelve a chequearlo por su cuenta.
 *
 * Los contactos normalmente entran solos cuando alguien escribe por
 * WhatsApp. Esto es para el que llama por teléfono y el que te pasan por
 * referido: no va a tener conversación hasta que escriba.
 */
export default async function NuevoContactoPage({
  searchParams,
}: {
  searchParams: Promise<{ etapa?: string }>
}) {
  const session = await requireTenant()
  if (!(await funcionActiva('alta-manual-contactos', session.tenantId))) {
    notFound()
  }

  const { etapa } = await searchParams
  const stages = await getStages(session)
  // La columna desde la que se tocó "Agregar", o la primera del embudo.
  const inicial = stages.find((s) => s.id === etapa) ?? stages[0]

  return (
    <>
      <div className="topnav">
        <Link href="/contactos" className="btn btn-ghost btn-sm">
          <IconBack />
          Contactos
        </Link>
        <h2>Nuevo contacto</h2>
      </div>

      <div className="content">
        <div className="panel-box" style={{ maxWidth: 560 }}>
          <div className="panel-box-body">
            <form action={crearContacto} style={{ display: 'grid', gap: 14 }}>
              <div className="field">
                <label htmlFor="displayName">Nombre</label>
                <input
                  id="displayName"
                  name="displayName"
                  className="input"
                  required
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="asunto">Asunto de la consulta</label>
                <input
                  id="asunto"
                  name="asunto"
                  className="input"
                  maxLength={200}
                  placeholder="Consulta por casa en Barrio Norte"
                />
              </div>
              <div className="field">
                <label htmlFor="phone">Teléfono</label>
                <input
                  id="phone"
                  name="phone"
                  className="input"
                  inputMode="tel"
                  maxLength={25}
                  placeholder="5493511234567"
                />
              </div>
              <div className="field">
                <label htmlFor="city">Ciudad / zona</label>
                <input id="city" name="city" className="input" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="stageId">Etapa</label>
                <select
                  id="stageId"
                  name="stageId"
                  className="select"
                  defaultValue={inicial?.id ?? ''}
                  required
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary">
                  Agregar
                </button>
                <Link href="/contactos" className="btn btn-ghost">
                  Cancelar
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}
