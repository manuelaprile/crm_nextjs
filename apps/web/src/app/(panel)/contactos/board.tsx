'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { moveContact } from '@/lib/actions'

type Card = {
  id: string
  displayName: string
  city: string | null
  phone: string | null
}

type Column = {
  id: string
  name: string
  color: string
  total: number
  contacts: Card[]
}

/**
 * Tablero de embudo con arrastrar y soltar.
 *
 * Usa la API nativa del navegador: sin librerías. La tarjeta se mueve en
 * pantalla antes de que el servidor confirme; si lo rechaza, vuelve sola y se
 * muestra el motivo.
 *
 * Cada tarjeta tiene además un `<select>` que hace lo mismo: arrastrar no
 * funciona con teclado ni en celular, y sin esa alternativa la función queda
 * fuera del alcance de quien no pueda usar el mouse.
 */
export function Board({ columns: inicial }: { columns: Column[] }) {
  const [columns, setColumns] = useState(inicial)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function mover(contactId: string, destinoId: string) {
    const origen = columns.find((c) => c.contacts.some((x) => x.id === contactId))
    if (!origen || origen.id === destinoId) return

    const card = origen.contacts.find((x) => x.id === contactId)!
    const previo = columns

    setColumns((cols) =>
      cols.map((c) => {
        if (c.id === origen.id) {
          return {
            ...c,
            total: c.total - 1,
            contacts: c.contacts.filter((x) => x.id !== contactId),
          }
        }
        if (c.id === destinoId) {
          return { ...c, total: c.total + 1, contacts: [card, ...c.contacts] }
        }
        return c
      }),
    )
    setError(null)

    startTransition(async () => {
      const res = await moveContact(contactId, destinoId)
      if (!res.ok) {
        setColumns(previo)
        setError(res.error ?? 'No se pudo mover el contacto')
      }
    })
  }

  return (
    <>
      {error && (
        <div className="alert alert-red" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="board">
        {columns.map((col) => {
          const activa = sobre === col.id && arrastrando !== null
          return (
            <div key={col.id} className="board-col">
              <div className="board-col-head">
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: col.color,
                  }}
                />
                <span className="nm">{col.name}</span>
                <span className="n mono">{col.total}</span>
              </div>

              <div
                className={`board-drop${activa ? ' over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setSobre(col.id)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setSobre((s) => (s === col.id ? null : s))
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain')
                  setSobre(null)
                  setArrastrando(null)
                  if (id) mover(id, col.id)
                }}
              >
                {col.contacts.length === 0 && (
                  <div className="board-empty">
                    {activa ? 'Soltá acá' : 'Vacío'}
                  </div>
                )}

                {col.contacts.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', c.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setArrastrando(c.id)
                    }}
                    onDragEnd={() => {
                      setArrastrando(null)
                      setSobre(null)
                    }}
                    className={`board-card${arrastrando === c.id ? ' dragging' : ''}`}
                  >
                    <Link href={`/contactos/${c.id}`} draggable={false}>
                      <div className="nm">{c.displayName}</div>
                      <div className="sub mono">
                        {[c.city, c.phone].filter(Boolean).join(' · ') || 'Sin datos'}
                      </div>
                    </Link>

                    <select
                      aria-label={`Cambiar etapa de ${c.displayName}`}
                      value={col.id}
                      onChange={(e) => mover(c.id, e.target.value)}
                      className="select"
                      style={{
                        marginTop: 9,
                        padding: '5px 8px',
                        fontSize: 11.5,
                        borderRadius: 'var(--r-sm)',
                        color: 'var(--c-muted)',
                      }}
                    >
                      {columns.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                {col.total > col.contacts.length && (
                  <p className="tiny muted" style={{ textAlign: 'center' }}>
                    + {col.total - col.contacts.length} más
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
