'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/lib/actions'
import {
  IconInbox,
  IconUsers,
  IconChart,
  IconWhatsApp,
  IconBot,
  IconMenu,
  IconFlask,
  IconShield,
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
}: {
  tenantName: string
  userName: string
  role: string
  unread: number
  modoPrueba: boolean
  esSuperadmin: boolean
}) {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)

  const grupos: { grp: string; items: Item[] }[] = [
    {
      grp: 'Atención',
      items: [
        { href: '/bandeja', label: 'Bandeja', icon: <IconInbox />, badge: unread },
        { href: '/contactos', label: 'Contactos', icon: <IconUsers /> },
      ],
    },
    {
      grp: 'Análisis',
      items: [{ href: '/reportes', label: 'Reportes', icon: <IconChart /> }],
    },
  ]

  // Un operador no configura nada: no tiene sentido mostrarle las pantallas
  // que después le van a decir que no. Los permisos igual se verifican del
  // lado del servidor — esto es prolijidad, no seguridad.
  if (role !== 'agent') {
    grupos.push({
      grp: 'Configuración',
      items: [
        { href: '/configuracion/whatsapp', label: 'WhatsApp', icon: <IconWhatsApp /> },
        { href: '/configuracion/ia', label: 'Asistente IA', icon: <IconBot /> },
        { href: '/configuracion/usuarios', label: 'Usuarios', icon: <IconUsers /> },
      ],
    })
  }

  if (esSuperadmin) {
    grupos.push({
      grp: 'Plataforma',
      items: [{ href: '/superadmin', label: 'Consultorios', icon: <IconShield /> }],
    })
  }

  // Solo aparece con TEST_MODE=1. En el servidor esa variable no existe.
  if (modoPrueba) {
    grupos.push({
      grp: 'Desarrollo',
      items: [{ href: '/pruebas', label: 'Laboratorio', icon: <IconFlask /> }],
    })
  }

  const rolLabel =
    role === 'owner' ? 'Dueño' : role === 'admin' ? 'Administrador' : 'Operador'

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
            <span className="logo-mark">{inicial(tenantName)}</span>
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
            CRM de consultas
          </div>
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
