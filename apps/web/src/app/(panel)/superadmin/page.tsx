import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { listarCuentas, mesesDeConsumo } from '@/lib/usuarios'
import { mesPedido, rotuloMes, cuando } from '@/lib/meses'
import { AccionesCuenta } from './acciones'
import { CambiarPlan } from './plan'
import { IconSearch } from '@/components/icons'
import { Paginacion } from '@/components/paginacion'

export const dynamic = 'force-dynamic'

/**
 * Vista global de la plataforma. Solo superadmin.
 *
 * Acá conviven rubros distintos —un consultorio, una inmobiliaria, un estudio
 * contable— así que la pantalla habla de «cuentas», que es lo neutro. El
 * rótulo propio de cada una aparece en la columna Rubro y, adentro, en todo
 * el panel.
 *
 * El consumo de IA se mira por MES o entero. Un panel que solo muestra el
 * mes en curso no sirve para decidir nada: el día 2 está casi vacío, no deja
 * ver si una cuenta viene creciendo, y el 1º a la madrugada borra el mes que
 * importaba. Lo que se elige acá viaja en la URL, así que un mes puntual se
 * puede compartir por link.
 *
 * Muestra NÚMEROS, no datos. El superadmin ve cuántos contactos tiene cada
 * cuenta y cuánto gastó de IA, pero no puede leer un solo mensaje ni un
 * nombre de paciente: eso lo garantiza RLS, no esta pantalla. Ver el
 * comentario de 0010_superadmin.sql.
 */
export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    p?: string
    pp?: string
    r?: string
    m?: string
    mes?: string
  }>
}) {
  const session = await getSession()
  if (!session?.isSuperadmin) notFound()

  const { q, p, pp, r, m, mes: mesParam } = await searchParams
  const porPagina = Number(pp) || 25
  const mes = mesPedido(mesParam)
  const [datos, meses] = await Promise.all([
    listarCuentas({ pagina: Number(p) || 1, porPagina, buscar: q, mes }),
    mesesDeConsumo(),
  ])
  const cuentas = datos.filas
  // Los topes son MENSUALES. Contra el histórico acumulado no significan
  // nada —"gastó 40 de un tope de 25" es falso si son seis meses— y contra un
  // mes cerrado tampoco: el tope pudo haber cambiado desde entonces. Así que
  // el divisor y el rojo aparecen solo en el mes en curso, que es el único
  // donde la comparación es cierta.
  const esMesEnCurso = mes !== null && mes === meses[0]
  // El total de IA es de la página visible, no de toda la plataforma: dejarlo
  // ambiguo sería peor que decirlo.
  const totalIa = cuentas.reduce((a, c) => a + Number(c.costoIa), 0)

  const link = (n: number) => {
    const sp = new URLSearchParams({ p: String(n) })
    if (porPagina !== 25) sp.set('pp', String(porPagina))
    if (q) sp.set('q', q)
    if (mesParam) sp.set('mes', mesParam)
    return `/superadmin?${sp.toString()}`
  }

  return (
    <>
      <div className="topnav">
        <h2>Plataforma</h2>
        <span className="badge b-dark">Superadmin</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/superadmin/funciones" className="btn btn-ghost btn-sm">
            Funciones
          </Link>
          <Link href="/superadmin/modulos" className="btn btn-ghost btn-sm">
            Módulos
          </Link>
          <Link href="/superadmin/usuarios" className="btn btn-ghost btn-sm">
            Usuarios
          </Link>
          <Link href="/superadmin/nueva" className="btn btn-primary btn-sm">
            Nueva cuenta
          </Link>
        </div>
      </div>

      <div className="content">
        {m ? (
          <div
            className={`alert ${r === 'ok' ? 'alert-green' : 'alert-red'}`}
            style={{ marginBottom: 16 }}
          >
            <span>{m}</span>
          </div>
        ) : null}

        <div className="stats">
          <div className="stat">
            <div className="lbl">Cuentas</div>
            <div className="val mono">{datos.total}</div>
          </div>
          <div className="stat">
            <div className="lbl">Activas</div>
            <div className="val mono">
              {cuentas.filter((c) => c.status === 'active').length}
            </div>
          </div>
          <div className="stat">
            <div className="lbl">Suspendidas</div>
            <div className="val mono">
              {cuentas.filter(
                (c) => c.status === 'suspended' || c.status === 'cancelled',
              ).length}
            </div>
          </div>
          <div className="stat">
            <div className="lbl">Contactos totales</div>
            <div className="val mono">
              {cuentas.reduce((a, c) => a + c.contactos, 0)}
            </div>
          </div>
          <div className="stat">
            <div className="lbl">Costo de IA · {rotuloMes(mes)}</div>
            <div className="val mono">USD {totalIa.toFixed(2)}</div>
            <div className="delta muted" style={{ fontWeight: 500 }}>
              de esta página
            </div>
          </div>
        </div>

        <form className="toolbar" action="/superadmin">
          <div className="searchbox">
            <IconSearch />
            <input name="q" defaultValue={q ?? ''} placeholder="Buscar por nombre o slug…" />
          </div>
          <select
            name="pp"
            defaultValue={String(porPagina)}
            className="select"
            style={{ width: 'auto' }}
            aria-label="Cuentas por página"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} por página</option>
            ))}
          </select>
          <select
            name="mes"
            defaultValue={mesParam ?? ''}
            className="select"
            style={{ width: 'auto' }}
            aria-label="Período del consumo de IA"
          >
            {meses.map((v, i) => (
              <option key={v} value={i === 0 ? '' : v}>
                {rotuloMes(v)}
                {i === 0 ? ' (en curso)' : ''}
              </option>
            ))}
            <option value="todo">Histórico acumulado</option>
          </select>
          <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
        </form>

        <div className="panel-box">
          <div className="panel-box-head">
            <h3>Cuentas</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Rubro</th>
                  <th>Estado</th>
                  <th>Plan</th>
                  <th style={{ textAlign: 'right' }}>Usuarios</th>
                  <th
                    style={{ textAlign: 'right' }}
                    title="Contactos sin archivar sobre el tope del plan. Es el límite que se vende: pasado el tope los contactos nuevos entran igual, pero sin asistente."
                  >
                    Contactos
                  </th>
                  <th
                    style={{ textAlign: 'right' }}
                    title="Todas las conversaciones que tuvo la cuenta desde que existe. NO sigue al desplegable de arriba: es lo que la cuenta tiene, no lo que pasó en un mes."
                  >
                    Conversaciones · total
                  </th>
                  <th
                    style={{ textAlign: 'right' }}
                    title={`Conversaciones distintas que atendió la IA en ${cuando(mes)}. Ya no es un límite —el plan se mide en contactos— pero muestra cuánto se usa el asistente.`}
                  >
                    IA · {rotuloMes(mes)}
                  </th>
                  <th
                    style={{ textAlign: 'right' }}
                    title={
                      esMesEnCurso
                        ? 'Gastado en IA este mes, sobre el tope de la cuenta'
                        : `Gastado en IA en ${cuando(mes)}. El tope no se muestra: es mensual y no se puede comparar contra esto.`
                    }
                  >
                    Costo USD
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cuentas.map((c) => {
                  const gasto = Number(c.costoIa)
                  const tope = Number(c.topeIa)
                  const cerca = esMesEnCurso && tope > 0 && gasto / tope > 0.8
                  // El tope que se vende. Se marca antes que el de gasto: es
                  // el que el cliente conoce y por el que va a llamar. No
                  // depende del mes elegido: los contactos son acumulados.
                  const contactosJustos =
                    c.maxContactos !== null &&
                    c.contactos / c.maxContactos > 0.8
                  return (
                    <tr key={c.id}>
                      <td>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                          {c.name}
                        </span>
                        <span className="tiny muted mono">{c.slug}</span>
                      </td>
                      <td className="muted">{c.rubro}</td>
                      <td>
                        <span
                          className={`badge ${
                            c.status === 'active'
                              ? 'b-green'
                              : c.status === 'trial'
                                ? 'b-blue'
                                : 'b-red'
                          } badge-dot`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td style={{ position: 'relative' }}>
                        <CambiarPlan cuenta={c} />
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {c.usuarios}
                        <span className="muted">/{c.maxUsuarios ?? '∞'}</span>
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: 'right',
                          color: contactosJustos ? 'var(--c-danger)' : undefined,
                          fontWeight: contactosJustos ? 600 : undefined,
                        }}
                      >
                        {c.contactos}
                        <span className="muted">/{c.maxContactos ?? '∞'}</span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {c.conversaciones}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {c.iaUsadas}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: 'right',
                          color: cerca ? 'var(--c-danger)' : undefined,
                          fontWeight: cerca ? 600 : undefined,
                        }}
                      >
                        {gasto.toFixed(2)}
                        {esMesEnCurso ? (
                          <span className="muted"> / {tope.toFixed(0)}</span>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'right', position: 'relative' }}>
                        <AccionesCuenta
                          cuenta={c}
                          adentro={session.tenantId === c.id}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Paginacion
            pagina={datos.pagina}
            paginas={datos.paginas}
            total={datos.total}
            porPagina={datos.porPagina}
            href={link}
          />
        </div>
      </div>
    </>
  )
}
