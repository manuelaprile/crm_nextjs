'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { moveContact } from '@/lib/actions'
import { asignarContacto } from '@/lib/contactos-acciones'
import type { TarjetaContacto } from '@/lib/queries'
import type { UsuarioAsignable } from '@/lib/asignacion'
import {
  IconWhatsApp,
  IconCalendar,
  IconTelefono,
  IconPersona,
  IconPuntos,
  IconMas,
} from '@/components/icons'
import { diaYHora, fecha } from '@/lib/fechas'

type Column = {
  id: string
  name: string
  color: string
  total: number
  isWon: boolean
  isLost: boolean
  contacts: TarjetaContacto[]
}

/**
 * Tablero de embudo con arrastrar y soltar.
 *
 * Usa la API nativa del navegador: sin librerías. La tarjeta se mueve en
 * pantalla antes de que el servidor confirme; si lo rechaza, vuelve sola y se
 * muestra el motivo.
 *
 * Arrastrar NO funciona con teclado ni en celular, así que cambiar de etapa
 * vive también en el menú de la tarjeta. Eso no es un extra de accesibilidad
 * al margen: en un teléfono es el único camino que hay.
 */
export function Board({
  columns: inicial,
  usuarios,
  puedeAsignar,
  zona,
  altaManual,
}: {
  columns: Column[]
  usuarios: UsuarioAsignable[]
  /** Solo owner/admin asignan. Ver `asignarContacto`. */
  puedeAsignar: boolean
  zona: string
  /** Interruptor `alta-manual-contactos`. Apagado, el botón no se dibuja. */
  altaManual: boolean
}) {
  const [columns, setColumns] = useState(inicial)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
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
    setAbierta(null)

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
                  <Tarjeta
                    key={c.id}
                    c={c}
                    col={col}
                    columns={columns}
                    zona={zona}
                    usuarios={usuarios}
                    puedeAsignar={puedeAsignar}
                    arrastrando={arrastrando === c.id}
                    menuAbierto={abierta === c.id}
                    onMenu={() => setAbierta((a) => (a === c.id ? null : c.id))}
                    onDragStart={() => setArrastrando(c.id)}
                    onDragEnd={() => {
                      setArrastrando(null)
                      setSobre(null)
                    }}
                    onMover={(destino) => mover(c.id, destino)}
                  />
                ))}

                {col.total > col.contacts.length && (
                  <p className="tiny muted" style={{ textAlign: 'center' }}>
                    + {col.total - col.contacts.length} más
                  </p>
                )}
              </div>

              {altaManual && (
                <Link href={`/contactos/nuevo?etapa=${col.id}`} className="board-alta">
                  <IconMas />
                  Agregar contacto
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------

function Tarjeta({
  c,
  col,
  columns,
  zona,
  usuarios,
  puedeAsignar,
  arrastrando,
  menuAbierto,
  onMenu,
  onDragStart,
  onDragEnd,
  onMover,
}: {
  c: TarjetaContacto
  col: Column
  columns: Column[]
  zona: string
  usuarios: UsuarioAsignable[]
  puedeAsignar: boolean
  arrastrando: boolean
  menuAbierto: boolean
  onMenu: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onMover: (destinoId: string) => void
}) {
  /**
   * La línea de abajo del todo cambia según dónde esté el contacto.
   *
   * En una etapa ganada o perdida ya no hay "próxima acción": lo que importa
   * es cuándo terminó. El rótulo sale del nombre de la etapa del cliente
   * ("Cerrado el:", "Descartado el:") y no de una lista fija: para una
   * inmobiliaria y para un consultorio esas etapas se llaman distinto.
   */
  const cierre =
    col.isWon || col.isLost
      ? `${col.name} el: ${fecha(c.enLaEtapaDesde, zona)}`
      : null

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', c.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={`board-card${arrastrando ? ' dragging' : ''}`}
    >
      <Link href={`/contactos/${c.id}`} draggable={false} className="bc-nombre">
        {c.displayName}
      </Link>

      {c.asunto ? (
        <div className="bc-asunto">
          <IconPersona />
          <span>{c.asunto}</span>
        </div>
      ) : null}

      {(c.etiquetas.length > 0 || c.proximaAccion || c.atiendePersona) && (
        <div className="bc-chips">
          {/*
            Dos chips los pone el sistema porque los sabe solo: que hay un
            turno por delante y que un hilo lo tomó una persona. El resto son
            las etiquetas que arma cada cuenta, con su color.
          */}
          {c.proximaAccion && (
            <span className="bc-chip bc-chip-turno">
              <IconCalendar />
              Visita agendada
            </span>
          )}
          {c.atiendePersona && (
            <span className="bc-chip bc-chip-humano">
              <IconPersona />
              Atiende una persona
            </span>
          )}
          {c.etiquetas.map((t) => (
            <span
              key={t.id}
              className="bc-chip"
              style={{ background: `${t.color}1a`, color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {cierre ? (
        <div className="bc-linea">
          <IconCalendar />
          <span>{cierre}</span>
        </div>
      ) : c.proximaAccion ? (
        <div className="bc-linea">
          <IconCalendar />
          <span>
            Próxima acción: {c.proximaAccion.tipo ?? c.proximaAccion.titulo} ·{' '}
            {diaYHora(c.proximaAccion.inicia, zona)}
          </span>
        </div>
      ) : null}

      <div className="bc-sep" />

      <div className="bc-asignado">
        <span className="muted">Asignado a:</span>
        {c.responsableNombre ? (
          <span className="bc-avatar" aria-hidden="true">
            {iniciales(c.responsableNombre)}
          </span>
        ) : null}
        {puedeAsignar ? (
          <form action={asignarContacto} style={{ minWidth: 0, flex: 1 }}>
            <input type="hidden" name="contactId" value={c.id} />
            <select
              name="userId"
              className="bc-select"
              defaultValue={c.responsableId ?? ''}
              aria-label={`Asignar ${c.displayName}`}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            >
              <option value="">Sin asignar</option>
              {usuarios
                .filter((u) => !u.deshabilitado || u.id === c.responsableId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
            </select>
          </form>
        ) : (
          <b className="bc-quien">{c.responsableNombre ?? 'Sin asignar'}</b>
        )}
      </div>

      <div className="bc-sep" />

      <div className="bc-acciones">
        {c.conversationId ? (
          <Link
            href={`/bandeja/${c.conversationId}`}
            draggable={false}
            className="bc-accion"
          >
            <IconWhatsApp className="bc-wa" />
            WhatsApp
          </Link>
        ) : (
          <span className="bc-accion off" title="Todavía no escribió por WhatsApp">
            <IconWhatsApp className="bc-wa" />
            WhatsApp
          </span>
        )}

        <Link
          href={`/agenda?contacto=${c.id}`}
          draggable={false}
          className="bc-accion"
        >
          <IconCalendar />
          Agendar
        </Link>

        {c.phone ? (
          <a href={`tel:+${c.phone}`} draggable={false} className="bc-accion">
            <IconTelefono />
            Llamar
          </a>
        ) : (
          <span className="bc-accion off" title="No tiene teléfono cargado">
            <IconTelefono />
            Llamar
          </span>
        )}

        <button
          type="button"
          className={`bc-accion bc-mas${menuAbierto ? ' on' : ''}`}
          aria-expanded={menuAbierto}
          aria-label={`Más acciones de ${c.displayName}`}
          onClick={onMenu}
        >
          <IconPuntos />
        </button>
      </div>

      {/*
        El menú se abre DENTRO de la tarjeta y no flotando encima: el tablero
        scrollea en horizontal, y cualquier cosa posicionada por afuera queda
        cortada por ese scroll. Creciendo hacia abajo se ve entera.
      */}
      {menuAbierto && (
        <div className="bc-menu">
          <label className="tiny muted" htmlFor={`etapa-${c.id}`}>
            Mover a
          </label>
          <select
            id={`etapa-${c.id}`}
            className="select"
            value={col.id}
            onChange={(e) => onMover(e.target.value)}
          >
            {columns.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <Link href={`/contactos/${c.id}`} draggable={false} className="bc-menu-item">
            Ver ficha completa
          </Link>
        </div>
      )}
    </div>
  )
}

function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
