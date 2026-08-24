import { requireTenant } from '@/lib/auth'
import { etiquetaDe, delRubro } from '@/lib/etiquetas'
import { getComercio, guardarComercio, subirLogo, quitarLogo } from '@/lib/comercio'

export const dynamic = 'force-dynamic'

/**
 * Datos del comercio.
 *
 * No es una pantalla de "configuración" más: es de donde el asistente saca la
 * dirección, los horarios y el teléfono para contestar. Antes eso había que
 * escribirlo a mano adentro del prompt y quedaba viejo sin que nadie se
 * enterara.
 */
export default async function ComercioPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; m?: string }>
}) {
  const session = await requireTenant()
  const etiqueta = etiquetaDe(session)
  const { r, m } = await searchParams

  if (session.role === 'agent') {
    return (
      <div className="panel-box">
        <div className="empty">
          <b>Sin permisos</b>
          Solo el dueño o un administrador puede editar estos datos.
        </div>
      </div>
    )
  }

  const c = await getComercio()

  return (
    <>
      {m ? (
        <div
          className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
          style={{ marginBottom: 16 }}
        >
          <span>{m}</span>
        </div>
      ) : null}

      {/* ---------------- Marca ---------------- */}
      <div className="panel-box" style={{ marginBottom: 16 }}>
        <div className="panel-box-head">
          <h3>Marca</h3>
          <span className="tiny muted">Se ve en el panel y en el menú</span>
        </div>
        <div className="panel-box-body">
          <div className="marca">
            <span className="marca-logo">
              {c.logoVersion ? (
                // La versión en la URL es la fecha de subida: sin eso el
                // navegador sigue mostrando el logo viejo después de cambiarlo.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/marca/logo?v=${c.logoVersion}`} alt="Logo" />
              ) : (
                (c.nombre.trim()[0] ?? 'C').toUpperCase()
              )}
            </span>

            <div style={{ flex: 1, minWidth: 220 }}>
              <form action={subirLogo} className="marca-subir">
                <input
                  type="file"
                  name="logo"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="input"
                  required
                />
                <button type="submit" className="btn btn-ghost btn-sm">
                  Subir logo
                </button>
              </form>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                PNG, JPG, WEBP o SVG, hasta 512 KB. Fondo transparente queda
                mejor sobre el menú.
              </p>
              {c.logoVersion ? (
                <form action={quitarLogo} style={{ marginTop: 8 }}>
                  <button
                    type="submit"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--c-danger)' }}
                  >
                    Quitar logo
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Datos ---------------- */}
      <form action={guardarComercio}>
        <div className="panel-box">
          <div className="panel-box-head">
            <h3>Datos {delRubro(etiqueta)}</h3>
            <span className="tiny muted">
              Los usa el asistente para contestar dirección, horarios y contacto
            </span>
          </div>
          <div className="panel-box-body">
            <div className="cols2b">
              <div className="field">
                <label htmlFor="nombre">Nombre comercial</label>
                <input
                  id="nombre"
                  name="nombre"
                  className="input"
                  defaultValue={c.nombre}
                  required
                  maxLength={120}
                />
              </div>
              <div className="field">
                <label htmlFor="razonSocial">Razón social</label>
                <input
                  id="razonSocial"
                  name="razonSocial"
                  className="input"
                  defaultValue={c.razonSocial}
                  maxLength={160}
                />
              </div>

              <div className="field">
                <label htmlFor="cuit">CUIT</label>
                <input
                  id="cuit"
                  name="cuit"
                  className="input"
                  defaultValue={c.cuit}
                  placeholder="30-71458922-4"
                  maxLength={20}
                />
              </div>
              <div className="field">
                <label htmlFor="telefono">Teléfono</label>
                <input
                  id="telefono"
                  name="telefono"
                  className="input"
                  defaultValue={c.telefono}
                  placeholder="221 415-8890"
                  maxLength={40}
                />
              </div>

              <div className="field">
                <label htmlFor="whatsapp">WhatsApp</label>
                <input
                  id="whatsapp"
                  name="whatsapp"
                  className="input"
                  defaultValue={c.whatsapp}
                  placeholder="+54 9 221 415-8890"
                  maxLength={40}
                />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="input"
                  defaultValue={c.email}
                  maxLength={160}
                />
              </div>

              <div className="field">
                <label htmlFor="direccion">Dirección</label>
                <input
                  id="direccion"
                  name="direccion"
                  className="input"
                  defaultValue={c.direccion}
                  maxLength={200}
                />
              </div>
              <div className="field">
                <label htmlFor="ciudad">Ciudad</label>
                <input
                  id="ciudad"
                  name="ciudad"
                  className="input"
                  defaultValue={c.ciudad}
                  maxLength={80}
                />
              </div>

              <div className="field">
                <label htmlFor="provincia">Provincia</label>
                <input
                  id="provincia"
                  name="provincia"
                  className="input"
                  defaultValue={c.provincia}
                  maxLength={80}
                />
              </div>
              <div className="field">
                <label htmlFor="codigoPostal">Código postal</label>
                <input
                  id="codigoPostal"
                  name="codigoPostal"
                  className="input"
                  defaultValue={c.codigoPostal}
                  maxLength={20}
                />
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="horarios">Horarios de atención</label>
              <input
                id="horarios"
                name="horarios"
                className="input"
                defaultValue={c.horarios}
                placeholder="Lunes a viernes de 9 a 18 h · Sábados de 10 a 14 h"
                maxLength={300}
              />
            </div>

            <div style={{ marginTop: 18 }}>
              <button type="submit" className="btn btn-primary">
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  )
}
