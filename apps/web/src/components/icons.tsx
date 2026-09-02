/**
 * Iconos del panel.
 *
 * Copiados de `mvp-preview.html` para que el trazo coincida exactamente:
 * mismo `stroke-width` (1.9 en los del menú), mismos remates redondeados y
 * mismo `viewBox`. Un set de iconos distinto se nota enseguida al lado del
 * prototipo, aunque los colores estén bien.
 */

type P = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
} as const

export const IconHome = ({ className }: P) => (
  <svg
    width="18"
    height="18"
    {...base}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M3 10l9-7 9 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
)

export const IconUsers = ({ className }: P) => (
  <svg width="18" height="18" {...base} strokeLinecap="round" className={className}>
    <path d="M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="3.5" />
    <path d="M22 20v-2a4 4 0 00-3-3.8" />
    <path d="M16 3.5a4 4 0 010 7" />
  </svg>
)

export const IconChart = ({ className }: P) => (
  <svg width="18" height="18" {...base} strokeLinecap="round" className={className}>
    <path d="M3 21h18" />
    <rect x="5" y="11" width="4" height="7" rx="1" />
    <rect x="12" y="6" width="4" height="12" rx="1" />
    <rect x="19" y="14" width="2" height="4" rx="1" />
  </svg>
)

/**
 * El logo real de WhatsApp: el teléfono dentro del globo, con la cola abajo
 * a la izquierda. El que había antes era un globo con un garabato adentro y
 * a tamaño chico no se reconocía.
 *
 * Es la marca de un tercero y se usa como lo que es: el rótulo del canal.
 * No va en la identidad del producto, que se revende con la marca de cada
 * quien (ver CLAUDE.md).
 */
export const IconWhatsApp = ({ className }: P) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.087 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
)

export const IconBot = ({ className }: P) => (
  <svg width="18" height="18" {...base} strokeLinejoin="round" className={className}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4" />
    <circle cx="12" cy="3" r="1.4" fill="currentColor" />
    <circle cx="9" cy="14" r="1.2" fill="currentColor" />
    <circle cx="15" cy="14" r="1.2" fill="currentColor" />
  </svg>
)

export const IconSearch = ({ className }: P) => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    className={className}
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

export const IconSend = ({ className }: P) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M2 21l21-9L2 3v7l14 2-14 2z" />
  </svg>
)

export const IconArrow = ({ className }: P) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const IconBack = ({ className }: P) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
)

export const IconMenu = ({ className }: P) => (
  <svg
    width="21"
    height="21"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    className={className}
  >
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
)

export const IconInbox = ({ className }: P) => (
  <svg width="18" height="18" {...base} strokeLinejoin="round" className={className}>
    <path d="M3 12h5l2 3h4l2-3h5" />
    <path d="M5.5 5h13l2.5 7v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" />
  </svg>
)

export const IconCalendar = ({ className }: P) => (
  <svg width="18" height="18" {...base} strokeLinejoin="round" className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
)

export const IconFlask = ({ className }: P) => (
  <svg width="18" height="18" {...base} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10 2v6.5L4.5 18a2 2 0 001.7 3h11.6a2 2 0 001.7-3L14 8.5V2" />
    <path d="M8.5 2h7" />
    <path d="M7 14h10" />
  </svg>
)

export const IconShield = ({ className }: P) => (
  <svg width="18" height="18" {...base} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
)

export const IconGear = ({ className }: P) => (
  <svg
    {...base}
    width="18"
    height="18"
    className={className}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
  </svg>
)

// ---------------------------------------------------------------------
// Tablero de contactos. Mismo trazo que los de arriba: 1.9, remates
// redondeados, viewBox de 24. Un set distinto se nota al lado del resto.
// ---------------------------------------------------------------------

export const IconTablero = ({ className }: P) => (
  <svg width="17" height="17" {...base} strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="5.5" height="16" rx="1.4" />
    <rect x="10.75" y="4" width="5.5" height="11" rx="1.4" />
    <rect x="18.5" y="4" width="2.5" height="16" rx="1.2" />
  </svg>
)

export const IconLista = ({ className }: P) => (
  <svg width="17" height="17" {...base} strokeLinecap="round" className={className}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
)

export const IconArchivo = ({ className }: P) => (
  <svg width="17" height="17" {...base} strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="18" height="4.5" rx="1.4" />
    <path d="M5 8.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19V8.5M10 12.5h4" />
  </svg>
)

/** Una hoja con la esquina doblada: un archivo adjunto, no una caja de archivo. */
export const IconDocumento = ({ className }: P) => (
  <svg width="17" height="17" {...base} strokeLinejoin="round" className={className}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
)

export const IconTelefono = ({ className }: P) => (
  <svg width="17" height="17" {...base} strokeLinejoin="round" className={className}>
    <path d="M21 16.9v2.1a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 011.1 3.2 2 2 0 013.1 1h2.1a2 2 0 012 1.7c.1 1 .3 1.9.7 2.8a2 2 0 01-.5 2.1L6.5 8.6a16 16 0 006 6l1-1a2 2 0 012.1-.5c.9.4 1.8.6 2.8.7a2 2 0 011.6 2.1z" />
  </svg>
)

export const IconPersona = ({ className }: P) => (
  <svg width="16" height="16" {...base} strokeLinejoin="round" className={className}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0115 0" />
  </svg>
)

export const IconPuntos = ({ className }: P) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
)

export const IconMas = ({ className }: P) => (
  <svg width="16" height="16" {...base} strokeLinecap="round" className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

// ---------------------------------------------------------------------
// Bandeja: solapas de filtro y chapas de estado. Mismo trazo que el resto
// (1.9, remates redondeados, viewBox de 24); el tamaño lo pone el CSS de
// `.chip` y `.badge`, así el mismo icono sirve en los dos lugares.
// ---------------------------------------------------------------------

export const IconCapas = ({ className }: P) => (
  <svg width="16" height="16" {...base} strokeLinejoin="round" className={className}>
    <path d="M12 3l9 4.4-9 4.4-9-4.4L12 3z" />
    <path d="M3 12.2l9 4.4 9-4.4" />
    <path d="M3 16.8l9 4.4 9-4.4" />
  </svg>
)

export const IconAlerta = ({ className }: P) => (
  <svg
    width="16"
    height="16"
    {...base}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 4.2L21.2 19.8H2.8L12 4.2z" />
    <path d="M12 10.2v4.1M12 17.2h.01" />
  </svg>
)

/** Calendario con tilde: hay un turno tomado, no solo una fecha. */
export const IconAgenda = ({ className }: P) => (
  <svg
    width="16"
    height="16"
    {...base}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M9 14.8l2.1 2.1 3.9-3.9" />
  </svg>
)

export const IconChevron = ({ className }: P) => (
  <svg
    width="16"
    height="16"
    {...base}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M6 9.5l6 6 6-6" />
  </svg>
)

/** Avión de papel: un mensaje que sale hacia varios. Es el de Campañas. */
export const IconCampana = ({ className }: P) => (
  <svg
    width="16"
    height="16"
    {...base}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M21.5 2.5L11 13" />
    <path d="M21.5 2.5l-6.5 19-4-8.5-8.5-4 19-6.5z" />
  </svg>
)
