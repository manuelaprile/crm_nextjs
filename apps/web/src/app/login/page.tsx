import { redirect } from 'next/navigation'
import { destinoInicial, getSession, login } from '@/lib/auth'
import { FormularioLogin } from './formulario'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; m?: string }>
}) {
  const yaEntro = await getSession()
  if (yaEntro) redirect(destinoInicial(yaEntro))
  const { error, m } = await searchParams

  async function action(formData: FormData) {
    'use server'
    // Los términos se validan ACÁ, no solo en el navegador. El checkbox del
    // formulario es comodidad: cualquiera puede mandar un POST sin él, y una
    // aceptación que se puede saltear no acepta nada.
    //
    // Va antes de mirar la contraseña a propósito: si no aceptó, no hay por
    // qué gastar un intento de login ni acercarlo al bloqueo por intentos
    // fallidos.
    if (formData.get('terminos') !== 'si') {
      redirect('/login?error=terminos')
    }
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    const result = await login(email, password)
    if (!result.ok) redirect(`/login?error=${result.error}`)
    // Un superadmin sin cuenta arranca en Plataforma, no en una bandeja que
    // no existe.
    const nueva = await getSession()
    redirect(nueva ? destinoInicial(nueva) : '/bandeja')
  }

  return (
    <main className="login-wrap">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div
            className="logo-mark"
            style={{ margin: '0 auto 14px', width: 40, height: 40, fontSize: 18 }}
          >
            C
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.025em' }}>
            Ingresar al panel
          </h1>
          <p className="muted tiny" style={{ marginTop: 4 }}>
            Gestión de consultas y contactos
          </p>
        </div>

        <FormularioLogin action={action} error={error} aviso={m} />
      </div>
    </main>
  )
}
