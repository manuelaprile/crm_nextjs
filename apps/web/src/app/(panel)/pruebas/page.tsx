import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { estadoPruebas, modoPruebaActivo } from '@/lib/pruebas'
import { FormSimulador, AccionesPrueba } from './form'

export const dynamic = 'force-dynamic'

export default async function PruebasPage() {
  // Sin TEST_MODE=1 la pantalla no existe. En el servidor no se define.
  if (!(await modoPruebaActivo())) notFound()

  const session = await requireTenant()
  if (session.role === 'agent') notFound()

  const estado = await estadoPruebas()

  return (
    <>
      <div className="topnav">
        <h2>Laboratorio de pruebas</h2>
        <span className="badge b-amber badge-dot">Modo prueba</span>
      </div>

      <div className="content" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <p style={{ marginTop: 0 }}>
            Probá el circuito completo sin vincular un celular
          </p>
        </div>

        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          <div className="stat">
            <div className="lbl">Número simulado</div>
            <div className="val" style={{ fontSize: 17 }}>
              {estado.numeroListo ? 'Listo' : 'Falta crear'}
            </div>
          </div>
          <div className="stat">
            <div className="lbl">Conversaciones</div>
            <div className="val mono">{estado.conversaciones}</div>
          </div>
          <div className="stat">
            <div className="lbl">Mensajes</div>
            <div className="val mono">{estado.mensajes}</div>
          </div>
          <div className="stat">
            <div className="lbl">Asistente</div>
            <div className="val" style={{ fontSize: 17 }}>
              {estado.iaActiva ? 'Activo' : 'Apagado'}
            </div>
            <div className="delta muted" style={{ fontWeight: 500 }}>
              {estado.proveedorIA}
              {estado.claveCargada ? ' · clave ok' : ' · sin clave'}
            </div>
          </div>
        </div>

        <AccionesPrueba numeroListo={estado.numeroListo} />

        {!estado.iaActiva && (
          <div className="alert alert-amber" style={{ marginBottom: 16 }}>
            <span>
              El asistente está apagado, así que los mensajes van a entrar pero
              nadie va a responder.{' '}
              <Link
                href="/configuracion/ia"
                style={{ textDecoration: 'underline', fontWeight: 600 }}
              >
                Configurarlo y activarlo →
              </Link>
            </span>
          </div>
        )}

        <FormSimulador numeroListo={estado.numeroListo} />

      </div>
    </>
  )
}
