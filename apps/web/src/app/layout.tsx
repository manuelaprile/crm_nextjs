import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// El prototipo usa Inter 400/500/600/700/800 desde Google Fonts. Acá va
// autoalojada: mismo tipo, sin pedido a un servidor externo.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CRM',
  description: 'Gestión de consultas y pacientes',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es-AR" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
