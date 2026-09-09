'use client'

import { useState } from 'react'
import { crearCuenta, type Rubro } from '@/lib/usuarios'

/**
 * Alta de una cuenta nueva.
 *
 * Es cliente por dos comodidades que ahorran errores de tipeo:
 *  - el identificador se arma solo a partir del nombre (se puede pisar);
 *  - elegir «Otro rubro» abre los campos para crearlo en el momento, así no
 *    hay que tocar la base para sumar un rubro que no estaba previsto.
 */
export function FormNuevaCuenta({ rubros }: { rubros: Rubro[] }) {
  const [rubro, setRubro] = useState(rubros[0]?.code ?? 'generico')
  const [nombre, setNombre] = useState('')
  // El singular del rubro nuevo, para poder mostrarlo en el desplegable del
  // artículo. Ver ahí abajo por qué.
  const [rubroSingular, setRubroSingular] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)

  const nuevo = rubro === '__nuevo'
  const slugMostrado = slugTocado ? slug : sluguear(nombre)

  return (
    <form action={crearCuenta} style={{ display: 'grid', gap: 14 }}>
      <div className="cols2b">
        <div className="field">
          <label htmlFor="nombre">Nombre</label>
          <input
            id="nombre"
            name="nombre"
            required
            className="input"
            placeholder="Dr. Santiago Echeverría"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
          <span className="tiny muted">El que ve el cliente arriba del menú.</span>
        </div>
        <div className="field">
          <label htmlFor="slug">Identificador</label>
          <input
            id="slug"
            name="slug"
            className="input mono"
            placeholder="dr-echeverria"
            value={slugMostrado}
            onChange={(e) => {
              setSlugTocado(true)
              setSlug(e.target.value)
            }}
          />
          <span className="tiny muted">
            Interno, para la base y los backups. No se puede cambiar después.
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rubro">Rubro</label>
        <select
          id="rubro"
          name="rubro"
          className="select"
          value={rubro}
          onChange={(e) => setRubro(e.target.value)}
        >
          {rubros.map((r) => (
            <option key={r.code} value={r.code}>
              {r.singular}
            </option>
          ))}
          <option value="__nuevo">Otro rubro…</option>
        </select>
        <span className="tiny muted">
          Define cómo se llama la cuenta en todo el panel y con qué embudo
          arranca. El cliente después renombra las etapas.
        </span>
      </div>

      {nuevo ? (
        <div
          className="panel-box"
          style={{ padding: 14, display: 'grid', gap: 14, background: 'var(--c-bg-soft, transparent)' }}
        >
          <div className="cols2b">
            <div className="field">
              <label htmlFor="rubroSingular">Cómo se llama (singular)</label>
              <input
                id="rubroSingular"
                name="rubroSingular"
                className="input"
                placeholder="Complejo"
                value={rubroSingular}
                onChange={(e) => setRubroSingular(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="rubroPlural">En plural</label>
              <input
                id="rubroPlural"
                name="rubroPlural"
                className="input"
                placeholder="Complejos"
              />
            </div>
          </div>
          {/*
            Acá se elige el GÉNERO, no el rubro.

            El nombre del rubro es el campo de arriba y siempre fue texto
            libre. Esto guarda «el» o «la», que es lo que después arma
            «del complejo» contra «de la inmobiliaria» en las frases del
            panel.

            Las opciones decían «el gimnasio» y «la inmobiliaria», y eso se
            leía como una lista de DOS RUBROS para elegir: alguien que iba a
            dar de alta un complejo no encontraba el suyo y no tenía forma de
            saber que el nombre ya lo había escrito arriba. Ahora la opción
            muestra la palabra que acaba de tipear, y la pregunta se contesta
            sola.
          */}
          <div className="field">
            <label htmlFor="rubroArticulo">Se dice…</label>
            <select
              id="rubroArticulo"
              name="rubroArticulo"
              className="select"
              defaultValue="el"
              style={{ width: 'auto' }}
            >
              <option value="el">el {palabra(rubroSingular)}</option>
              <option value="la">la {palabra(rubroSingular)}</option>
            </select>
            <span className="tiny muted">
              Solo para que las frases del panel queden bien escritas.
            </span>
          </div>
        </div>
      ) : null}

      <div className="cols2b">
        <div className="field">
          <label htmlFor="email">Email del dueño</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="input"
            placeholder="secretaria@correo.com"
          />
        </div>
        <div className="field">
          <label htmlFor="nombreUsuario">Nombre del dueño</label>
          <input
            id="nombreUsuario"
            name="nombreUsuario"
            className="input"
            placeholder="Si lo dejás vacío, usa el nombre de la cuenta"
          />
        </div>
      </div>

      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="clave">Contraseña inicial</label>
        <input
          id="clave"
          name="clave"
          type="password"
          minLength={8}
          required
          className="input"
          placeholder="Mínimo 8 caracteres"
        />
        <span className="tiny muted">
          Si el email ya existe en el sistema, se le respeta la que tenía.
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="submit" className="btn btn-primary">
          Crear cuenta
        </button>
        <a href="/superadmin" className="btn btn-ghost">
          Cancelar
        </a>
      </div>
    </form>
  )
}

/** Misma regla que el servidor, acá solo para mostrarlo mientras se escribe. */
function sluguear(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * La palabra del rubro para mostrarla en el desplegable del artículo.
 *
 * En minúscula porque va dentro de una frase, y con un ejemplo mientras el
 * campo esté vacío: un «el» y un «la» pelados no dejan ver para qué sirve
 * la pregunta.
 */
function palabra(singular: string): string {
  return singular.trim().toLowerCase() || 'complejo'
}
