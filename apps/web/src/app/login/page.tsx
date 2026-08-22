import { redirect } from 'next/navigation'
import { getSession, login } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await getSession()) redirect('/bandeja')
  const { error } = await searchParams

  async function action(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    const result = await login(email, password)
    if (!result.ok) redirect(`/login?error=${result.error}`)
    redirect('/bandeja')
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
            Gestión de consultas y pacientes
          </p>
        </div>

        <form
          action={action}
          className="login-card"
          style={{ display: 'grid', gap: 16 }}
        >
          {error && (
            <div className="alert alert-red">
              {error === 'bloqueado'
                ? 'Demasiados intentos fallidos. Esperá 15 minutos.'
                : 'Email o contraseña incorrectos.'}
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              className="input"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block">
            Ingresar
          </button>
        </form>
      </div>
    </main>
  )
}
