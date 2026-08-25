import type { Adjunto } from '@/lib/media'

/**
 * Un adjunto dentro de la burbuja del mensaje.
 *
 * Lo que se puede mostrar se muestra —una foto es una foto, no "[image]"—.
 * Lo que no, se ofrece para descargar. Y cuando algo falló, se dice qué pasó
 * en vez de dejar un hueco: la secretaria tiene que poder decirle al paciente
 * "no me llegó la foto, ¿me la reenviás?" en lugar de no enterarse.
 */
export function AdjuntoEnMensaje({
  a,
  cuerpo,
}: {
  a: Adjunto
  /** El texto del mensaje, para no repetirlo si ya es la transcripción. */
  cuerpo?: string | null
}) {
  const src = `/api/media/${a.id}`

  return (
    <div style={{ marginTop: 6 }}>
      {a.hayArchivo && a.kind === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element
        <a href={src} target="_blank" rel="noreferrer">
          <img
            src={src}
            alt={a.filename ?? 'Imagen del paciente'}
            style={{
              maxWidth: '100%',
              maxHeight: 320,
              borderRadius: 'var(--r-sm)',
              display: 'block',
            }}
          />
        </a>
      )}

      {a.hayArchivo && a.kind === 'video' && (
        <video
          src={src}
          controls
          preload="metadata"
          style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 'var(--r-sm)' }}
        />
      )}

      {a.hayArchivo && a.kind === 'audio' && (
        <audio src={src} controls preload="metadata" style={{ maxWidth: '100%' }} />
      )}

      {a.hayArchivo && a.kind === 'sticker' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Sticker" style={{ width: 120, height: 120 }} />
      )}

      {a.hayArchivo && a.kind === 'document' && (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: 'none' }}
        >
          📎 {a.filename ?? 'Descargar archivo'}
          {a.sizeBytes ? ` · ${peso(a.sizeBytes)}` : ''}
        </a>
      )}

      {/* La transcripción del audio, que es lo que hace que un audio se pueda
          leer de un vistazo sin escucharlo entero — y lo que ve el agente. */}
      {a.transcript && a.transcript !== cuerpo?.trim() && (
        <div
          className="tiny"
          style={{
            marginTop: 6,
            padding: '7px 9px',
            borderRadius: 'var(--r-sm)',
            background: 'rgb(0 0 0 / 0.06)',
            lineHeight: 1.45,
          }}
        >
          <span style={{ opacity: 0.65 }}>Transcripción: </span>
          {a.transcript}
        </div>
      )}

      {!a.hayArchivo && (
        <div className="tiny" style={{ opacity: 0.8 }}>
          📎 {etiqueta(a.kind)}
          {a.filename ? ` · ${a.filename}` : ''}
          {a.error ? ` — ${a.error}` : ' — no se pudo guardar.'}
        </div>
      )}

      {a.hayArchivo && a.error && (
        <div className="tiny" style={{ opacity: 0.8, marginTop: 4 }}>
          {a.error}
        </div>
      )}
    </div>
  )
}

function etiqueta(kind: string): string {
  switch (kind) {
    case 'image':
      return 'Imagen'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'sticker':
      return 'Sticker'
    default:
      return 'Archivo'
  }
}

function peso(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
