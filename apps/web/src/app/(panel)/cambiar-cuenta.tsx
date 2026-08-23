'use client'

import { useEffect, useRef, useState } from 'react'
import { cambiarDeCuenta, volverAPlataforma } from '@/lib/usuarios'
import { IconShield } from '@/components/icons'

/**
 * Selector de cuenta activa, en la cabecera del menú.
 *
 * Aparece en dos situaciones:
 *
 *  - El usuario pertenece a más de una cuenta (una secretaria que atiende a
 *    dos médicos, por ejemplo). Cambia entre las suyas.
 *  - Es superadmin y entró a dar soporte. Puede saltar a otra o volver a la
 *    vista de plataforma.
 *
 * Con una sola cuenta y sin ser superadmin no se muestra nada: no tendría a
 * dónde ir.
 *
 * El rótulo lo pone quien lo usa: adentro de un consultorio dice «Cambiar de
 * consultorio», adentro de una inmobiliaria dice «Cambiar de inmobiliaria».
 */
export function CambiarCuenta({
  actual,
  opciones,
  esSuperadmin,
  esVisita,
  rubro,
}: {
  actual: string
  opciones: { id: string; nombre: string; rubro?: string }[]
  esSuperadmin: boolean
  /** El superadmin está adentro de una cuenta de la que no es miembro. */
  esVisita: boolean
  /** Cómo se llama esta cuenta: "Consultorio", "Inmobiliaria"… */
  rubro: string
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  // Cerrar al hacer clic afuera o con Escape: sin esto el panel queda colgado
  // encima del menú y hay que recargar.
  useEffect(() => {
    if (!abierto) return
    const clic = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', clic)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', clic)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])

  const otros = opciones.filter((o) => o.nombre !== actual)
  if (!esSuperadmin && otros.length === 0) return null

  return (
    <div ref={caja} style={{ position: 'relative', marginTop: 8 }}>
      <button
        type="button"
        className="snav"
        onClick={() => setAbierto((v) => !v)}
        style={{ width: '100%', fontSize: 12.5, justifyContent: 'space-between' }}
      >
        <span>Cambiar de {rubro.toLowerCase()}</span>
        <span aria-hidden style={{ opacity: 0.5 }}>
          {abierto ? '▴' : '▾'}
        </span>
      </button>

      {abierto ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            padding: 4,
            zIndex: 600,
            background: 'var(--c-bg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            boxShadow: '0 8px 24px rgba(0,0,0,.10)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {esSuperadmin ? (
            <form action={volverAPlataforma}>
              <button
                type="submit"
                className="snav"
                style={{ width: '100%', fontSize: 13 }}
              >
                <IconShield />
                <span>{esVisita ? 'Salir a Plataforma' : 'Ver Plataforma'}</span>
              </button>
            </form>
          ) : null}

          {otros.map((o) => (
            <form key={o.id} action={cambiarDeCuenta}>
              <input type="hidden" name="tenantId" value={o.id} />
              <button
                type="submit"
                className="snav"
                style={{ width: '100%', fontSize: 13 }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {o.nombre}
                  {/* Con rubros mezclados —un consultorio y una inmobiliaria—
                      el solo nombre no siempre alcanza para saber cuál es. */}
                  {o.rubro ? (
                    <span className="tiny muted" style={{ marginLeft: 6 }}>
                      {o.rubro}
                    </span>
                  ) : null}
                </span>
              </button>
            </form>
          ))}

          {esSuperadmin && otros.length === 0 ? (
            <div className="tiny muted" style={{ padding: '6px 10px' }}>
              Para entrar a otra cuenta, andá a Plataforma.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
