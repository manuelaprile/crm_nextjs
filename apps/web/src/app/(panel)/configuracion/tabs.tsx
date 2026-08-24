'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECCIONES = [
  { href: '/configuracion/comercio', label: 'Comercio' },
  { href: '/configuracion/whatsapp', label: 'WhatsApp' },
  { href: '/configuracion/ia', label: 'Asistente IA' },
  { href: '/configuracion/usuarios', label: 'Usuarios' },
]

/** Las solapas de Configuración. Cliente por el `usePathname` de la activa. */
export function TabsConfiguracion() {
  const pathname = usePathname()
  return (
    <nav className="tabs">
      {SECCIONES.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className={`tab${pathname.startsWith(s.href) ? ' on' : ''}`}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  )
}
