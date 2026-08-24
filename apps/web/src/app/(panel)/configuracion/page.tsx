import { redirect } from 'next/navigation'

/** /configuracion no es una pantalla: cae en la primera solapa. */
export default function ConfiguracionIndex() {
  redirect('/configuracion/comercio')
}
