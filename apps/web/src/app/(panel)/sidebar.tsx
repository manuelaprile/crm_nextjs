'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/lib/actions'
import { CambiarCuenta } from './cambiar-cuenta'
import { useSinLeer } from './pulso-provider'
import { BotonSonido } from './sonido-boton'
import {
  IconInbox,
  IconUsers,
  IconChart,
  IconWhatsApp,
  IconMenu,
  IconFlask,
  IconShield,
  IconGear,
} from '@/components/icons'

/**
 * Menú lateral. Replica la estructura del prototipo del cliente:
 * grupos en versalitas, ítem activo en negro sólido, badge de no leídos en
 * rojo, y el chip de usuario abajo con avatar de iniciales.
 *
 * Es componente de cliente porque necesita `usePathname` para marcar el ítem
 * activo y el toggle del menú en pantallas chicas.
 */

type Item = { href: string; label: string; icon: React.ReactNode; badge?: number }

export function Sidebar({
  tenantName,
  userName,
  role,
  unread,
  modoPrueba,
  esSuperadmin,
  sinCuenta,
  cuentas,
  esVisita,
  rubro,
  logoVersion,
}: {
  tenantName: string
  userName: string
  role: string
  unread: number
  modoPrueba: boolean
  esSuperadmin: boolean
  /** Superadmin que no pertenece a ninguna cuenta: solo ve Plataforma. */
  sinCuenta: boolean
  /** Las cuentas propias del usuario, para el selector. */
  cuentas: { id: string; nombre: string; rubro?: string }[]
  /** Superadmin parado adentro de una cuenta ajena. */
  esVisita: boolean
  /** Cómo se llama esta cuenta: "Consultorio", "Inmobiliaria"… */
  rubro: string
  /** Fecha de la última subida del logo, o null si no cargaron ninguno. */
  logoVersion: string | null
}) {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)

  /**
   * El número de sin leer, en vivo.
   *
   * `unread` es lo que calculó el servidor al pintar la página, y sirve para
   * el primer instante: sin él el numerito parpadearía en cero hasta que
   * llegue el primer latido. Después manda el latido, que es el único que se
   * entera cuando entra un mensaje o cuando se lee una conversación sin
   * recargar nada.
   */
  const enVivo = useSinLeer()
  const noLeidos = enVivo ?? unread

  const grupos: { grp: string; items: Item[] }[] = []

  // Las secciones de una cuenta solo tienen sentido si hay una.
  if (!sinCuenta) {
    grupos.push(
      {
        grp: 'Atención',
        items: [
          { href: '/bandeja', label: 'Bandeja', icon: <IconInbox />, badge: noLeidos },
          { href: '/contactos', label: 'Contactos', icon: <IconUsers /> },
        ],
      },
      {
        grp: 'Análisis',
        items: [{ href: '/reportes', label: 'Reportes', icon: <IconChart /> }],
      },
    )
  }

  // Un operador no configura nada: no tiene sentido mostrarle las pantallas
  // que después le van a decir que no. Los permisos igual se verifican del
  // lado del servidor — esto es prolijidad, no seguridad.
  if (!sinCuenta && role !== 'agent') {
    // Etapas y Asistente IA NO están acá a propósito: se llega por las
    // solapas de Configuración. Un menú con nueve ítems es un menú que nadie
    // lee.
    grupos.push({
      grp: 'General',
      items: [
        { href: '/configuracion/general', label: 'Configuración', icon: <IconGear /> },
        { href: '/configuracion/whatsapp', label: 'WhatsApp', icon: <IconWhatsApp /> },
        { href: '/configuracion/usuarios', label: 'Usuarios', icon: <IconUsers /> },
      ],
    })
  }

  if (esSuperadmin) {
    grupos.push({
      grp: 'Plataforma',
      items: [{ href: '/superadmin', label: 'Cuentas', icon: <IconShield /> }],
    })
  }

  // Solo aparece con TEST_MODE=1. En el servidor esa variable no existe.
  if (modoPrueba) {
    grupos.push({
      grp: 'Desarrollo',
      items: [{ href: '/pruebas', label: 'Laboratorio', icon: <IconFlask /> }],
    })
  }

  const rolLabel = sinCuenta
    ? 'Superadministrador'
    : role === 'owner'
      ? 'Dueño'
      : role === 'admin'
        ? 'Administrador'
        : 'Operador'

  return (
    <>
      <button
        className="icon-btn mobile-only"
        onClick={() => setAbierto((v) => !v)}
        aria-label="Menú"
        style={{
          position: 'fixed',
          top: 14,
          left: 14,
          zIndex: 500,
          width: 40,
          height: 40,
          borderRadius: 'var(--r-sm)',
          background: 'var(--c-bg)',
          border: '1px solid var(--c-border)',
          placeItems: 'center',
        }}
      >
        <IconMenu />
      </button>

      <aside className={`side${abierto ? ' open' : ''}`}>
        <div className="side-head">
          <div className="logo">
            <span className="logo-mark">
              {logoVersion ? (
                // La versión rompe la caché: sin esto el menú sigue mostrando
                // el logo viejo hasta que el navegador se digne a recargarlo.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/marca/logo?v=${logoVersion}`} alt="" />
              ) : (
                inicial(tenantName)
              )}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {tenantName}
            </span>
          </div>
          <div className="tiny muted" style={{ marginTop: 4, paddingLeft: 2 }}>
            {sinCuenta
              ? 'Administración'
              : esVisita
                ? 'Visita de soporte'
                : rubro}
          </div>
          {sinCuenta ? null : (
            <CambiarCuenta
              actual={tenantName}
              opciones={cuentas}
              esSuperadmin={esSuperadmin}
              esVisita={esVisita}
              rubro={rubro}
            />
          )}
        </div>

        <nav className="side-nav">
          {grupos.map((g) => (
            <div key={g.grp}>
              <div className="grp">{g.grp}</div>
              {g.items.map((it) => {
                const activo =
                  pathname === it.href || pathname.startsWith(`${it.href}/`)
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`snav${activo ? ' on' : ''}`}
                    onClick={() => setAbierto(false)}
                  >
                    {it.icon}
                    <span>{it.label}</span>
                    {it.badge ? <span className="n">{it.badge}</span> : null}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <div className="user-chip">
            <span className="avatar">{iniciales(userName)}</span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {userName}
              </div>
              <div className="tiny muted">{rolLabel}</div>
            </div>
          </div>
          {/* Solo tiene sentido donde hay bandeja. Un superadmin en la vista
              de plataforma no recibe mensajes de nadie. */}
          {!sinCuenta && <BotonSonido />}
          <form action={signOut}>
            <button
              type="submit"
              className="snav"
              style={{ marginTop: 4, fontSize: 13 }}
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
    </>
  )
}

function inicial(nombre: string): string {
  return nombre.trim().charAt(0).toUpperCase() || 'C'
}

function iniciales(nombre: string): string {
  return (
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  )
}
