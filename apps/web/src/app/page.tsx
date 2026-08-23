import { redirect } from 'next/navigation'
import { destinoInicial, getSession } from '@/lib/auth'

export default async function Home() {
  const session = await getSession()
  redirect(session ? destinoInicial(session) : '/login')
}
