import type { NextConfig } from 'next'

const enDesarrollo = process.env.NODE_ENV !== 'production'

/**
 * Política de seguridad de contenido.
 *
 * En DESARROLLO se agrega `'unsafe-eval'` porque React lo necesita para sus
 * herramientas de depuración (reconstruir stacks, fast refresh). Sin eso el
 * JavaScript del cliente queda roto y los formularios interactivos —el de la
 * clave de API, el tablero de arrastrar y soltar— dejan de funcionar sin un
 * error visible en pantalla.
 *
 * En PRODUCCIÓN no se agrega: React no usa eval() ahí, y permitirlo abriría
 * la puerta a ejecutar strings como código si alguna vez entra contenido
 * ajeno a la página.
 */
const csp = [
  "default-src 'self'",
  // El QR llega como data URL desde el worker.
  "img-src 'self' data: blob:",
  `script-src 'self' 'unsafe-inline'${enDesarrollo ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // En desarrollo el websocket de recarga en caliente necesita ws:.
  `connect-src 'self'${enDesarrollo ? ' ws: wss:' : ''}`,
  "font-src 'self' data:",
  // Audios y videos que mandan los pacientes. Sin declararlo cae en
  // `default-src`, que hoy alcanza — pero el día que default-src se ajuste,
  // los audios dejarían de reproducirse sin ningún error de servidor y sin
  // que nadie relacione una cosa con la otra.
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // 'self' y no 'none': con `object-src 'none'` el visor de PDF de Chrome
  // queda bloqueado y abrir un estudio que mandó un paciente muestra un
  // error en vez del documento. Se sigue prohibiendo cualquier objeto de
  // otro origen, que es lo que importa.
  "object-src 'self'",
].join('; ')

const config: NextConfig = {
  // La "N" flotante que Next muestra en desarrollo. Los errores de
  // compilación se siguen viendo igual: esto solo saca el indicador.
  devIndicators: false,
  // Empaqueta solo lo necesario en la imagen de Docker.
  output: 'standalone',
  // `pg` es nativo: no puede pasar por el bundler del servidor.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
}

export default config
