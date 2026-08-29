# CRM multicanal por verticales — contrato del proyecto

Leer entero antes de escribir una línea. Este archivo sobrevive entre sesiones:
toda decisión que no se deduce del código se anota acá.

## Qué es

Una plataforma CRM **multi-tenant** con bandeja única de WhatsApp y un agente de IA
que califica y deriva. Un solo código, N verticales. El primer vertical en producción
es **médico** (consultorio de cirugía); e-commerce y colegios vienen después como
módulos encima del mismo núcleo.

Producto comercial: se revende white-label. Nada de dependencias con cláusulas de
marca, logo ajeno o phone-home.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui
- Postgres 16 propio (NO Supabase) + Drizzle ORM
- Auth.js (credentials + Drizzle adapter)
- WhatsApp: **Baileys 6.7.x** en un worker propio (`apps/wa-worker`)
- IA: Anthropic (`claude-haiku-4-5` por defecto, escala a `claude-sonnet-5`)
- Deploy: **un solo VPS** con Docker Compose + Caddy

## El modelo conceptual

Si se rompe acá, no se arregla después.

1. **CANAL y PROVEEDOR son dos ejes distintos.**
   `channel` = la red que ve la persona (`whatsapp` | `instagram` | `facebook`)
   `provider` = por dónde viaja (`baileys` | `cloud_api` | ...)
   Columnas separadas. Hoy es `whatsapp`+`baileys`; el día que un cliente migre a
   Cloud API oficial conviven las dos combinaciones sin tocar una pantalla.

2. **La unidad NO es el contacto: es la CONVERSACIÓN.**
   La misma persona puede tener un hilo de WhatsApp y otro de Instagram y no se
   mezclan. Rutas e historial del agente van por `conversationId`, nunca por
   `contactId`.

3. **La identidad NO es el teléfono.**
   `contact_identities (tenant_id, channel, external_id)` único. En WhatsApp el
   teléfono puede venir nulo o cambiar (LID): anclamos en el JID que da el
   proveedor, y el teléfono es un atributo, no la clave.

4. **El PIPELINE es la primitiva que hace multi-vertical al producto.**
   Las 4 etapas del cirujano, las etapas de admisión de un colegio y el embudo de
   pedidos de una tienda son la misma tabla `stages` + `stage_history`. Eso da el
   reporte de conversión gratis en los tres nichos. NUNCA hardcodear etapas.

5. **El RUBRO es un rótulo, no una rama de código.**
   Consultorio, inmobiliaria, estudio contable: el sistema es el mismo. El rubro
   vive en la tabla `verticals` (código, singular, plural, género) y `tenants.vertical`
   lo referencia. En la interfaz el rótulo sale de la sesión (`etiquetaDe()` en
   `lib/etiquetas.ts`), NUNCA escrito a mano. No decir "consultorio" en una
   pantalla: para una inmobiliaria queda mal y para el próximo rubro, peor.
   Lo mismo con los reportes: los rótulos salen de las etapas del cliente
   (`is_won`, posición), no de una lista fija. En la vista de plataforma, donde
   conviven rubros distintos, el término neutro es **cuenta**.
   Sumar un rubro NO es una migración: es el alta desde el panel.

## Reglas duras

Romper cualquiera de estas no produce un error: produce mensajes que se pierden en
silencio, que es mucho peor.

- **La entrega es at-least-once.** Reclamar cada evento por su id en
  `webhook_events` con `INSERT ... ON CONFLICT DO NOTHING RETURNING` ANTES de
  procesarlo. Si no insertó, es un reintento: cortar.

- **El índice único de idempotencia de mensajes va sobre `external_id` SOLO**
  (parcial, `where external_id is not null`), no sobre `(provider, external_id)`.
  Si un tenant migra de Baileys a Cloud API, el mismo id entra por dos caminos y
  con clave compuesta se duplica. Y sin el `where`, los mensajes salientes propios
  chocan entre sí antes de tener id.

- **UN SOLO camino de salida:** `deliverMessage(conversationId, ...)` que envía Y
  persiste. Si la UI inserta por un lado y el agente por otro, se desincronizan y
  aparecen mensajes enviados que no figuran en el historial.

- **Doble interruptor para la IA:** `conversations.ai_enabled` Y
  `agent_configs.enabled`. Los dos en true para que conteste. El primero es para
  que la secretaria tome un hilo a mano; el segundo apaga un canal entero.

- **Descartar mensajes viejos.** Si un job quedó encolado y se procesa una hora
  después, no contestarle al paciente como si acabara de escribir.

- **Al importar historial, el agente NO se dispara.** Contestarle de golpe a
  cientos de pacientes viejos es un desastre difícil de explicar.

- **La conversación tiene un responsable, y verlo no es un permiso.**
  `conversations.assigned_user_id` dice a quién le toca; va en la conversación
  y no en el contacto por la regla 2. La bandeja la ve ENTERA cualquiera de la
  cuenta —el filtro por responsable es para ordenarse, no una pared—, porque
  el problema que resuelve es que dos personas contesten el mismo mensaje, y
  para eso hay que poder ver que el hilo ya tiene dueño. Lo que sí es permiso
  es DERIVAR: solo owner/admin. Cada cambio deja fila en
  `conversation_assignments`, que no se edita ni se borra.

- **`tenant_id` en el `WHERE` de toda consulta.** RLS con
  `current_setting('app.tenant_id')` es la red de seguridad, no la primera línea.
  El `tenant_id` sale del contexto de sesión, NUNCA del body del request.

## Reglas de despliegue

Todos los clientes comparten UN contenedor y UNA base. No existe actualizar a un
cliente y a otro no: cuando algo sale mal, sale mal para todos a la vez. Lo único
que se puede acortar es cuánto dura.

- **Las migraciones son ADITIVAS en el deploy que cambia el código.** Nunca borrar
  ni renombrar una columna en la misma actualización en que el código deja de
  usarla. Primero se deja de usar y se sube; se borra un deploy después. Así hay
  siempre un momento en que la versión vieja y la nueva funcionan con el mismo
  esquema, y ese momento es lo que hace posible volver atrás.
- **`git revert` no devuelve una columna borrada.** Por eso `./crm.sh actualizar`
  hace una copia de la base antes de migrar. Es la única red que hay para el daño
  que no se deshace.
- **Un deploy que no se puede deshacer se avisa.** Si una migración es destructiva
  y no hay forma de partirla en dos, se dice antes de subirla.
- **Lo nuevo y riesgoso sale apagado.** Ver `feature_flags`: se prende primero en
  una cuenta, se mira, y recién después en todas. Es lo más parecido a un
  despliegue gradual que permite esta arquitectura, y solo cubre lo que se
  acordaron de poner detrás del interruptor.

## Reglas específicas de Baileys (no negociable: conexión por QR)

El cliente exigió conexión por escaneo de QR. Es una librería no oficial y va contra
los términos de Meta. Las consecuencias se mitigan así:

- **Auth state en Postgres, no en disco.** `channel_accounts.session_state` +
  `wa_session_keys`. Un contenedor que se recrea no puede perder la sesión.
- **Una sesión por tenant, en un solo proceso worker** con un mapa en memoria.
  ~80MB RAM por número conectado. Presupuestar el VPS con eso.
- **Reconexión con backoff exponencial** y tope. `DisconnectReason.loggedOut`
  NO se reintenta: hay que re-escanear, y eso se avisa en el panel y por mail.
- **Nunca enviar en ráfaga.** Cola con jitter (mín. 3-8s entre mensajes a números
  distintos). El envío masivo es lo que dispara el baneo.
- **No responder a números que nunca escribieron.** Solo hilos entrantes.
- **Contrato firmado con el cliente** que reconoce el riesgo de baneo del número.
  El texto vive en `docs/descargo-whatsapp.md`.
- La abstracción `WhatsAppProvider` existe desde el día uno para poder mover un
  tenant a Cloud API oficial sin tocar el resto del sistema.

## Reglas del vertical médico

- **El CRM guarda información COMERCIAL, no clínica.** Etapa del embudo, zona,
  etiquetas, notas administrativas. Nada de diagnóstico ni detalle clínico: en
  Argentina los datos de salud son datos sensibles (Ley 25.326) y eso multiplica
  las obligaciones. Si algún día hace falta historia clínica, es otro producto.
- **La IA NUNCA da indicación médica.** Ni dosis, ni pronóstico, ni "eso se
  resuelve con tal cirugía". Califica, toma datos y deriva.
- `agent_configs.handoff_keywords` dispara pase a humano inmediato (dolor, urgencia,
  sangrado, complicación, etc.). Ante la duda, deriva.

## Cómo trabajar

Por fases. Al terminar cada una, `typecheck` + `lint` + **build de producción**
tienen que pasar limpios antes de seguir. El chequeo incremental deja pasar cosas
que el build encuentra.

- Fase 1 — Modelo de datos y migración
- Fase 2 — Worker de WhatsApp (Baileys): sesión, QR, reconexión, in/out
- Fase 3 — Ingesta: webhook interno, idempotencia, resolución de contacto
- Fase 4 — Bandeja: listar, abrir, responder
- Fase 5 — Pipeline: etapas, etiquetas, notas, embudo
- Fase 6 — Agente de IA: califica y deriva
- Fase 7 — Superadmin, deploy, backups

Verificar contra la realidad, no contra supuestos: después de cada fase, un script
que pegue contra el sistema de verdad y muestre lo que devuelve. Un webhook que
responde 200 no prueba nada; lo que prueba es la fila en la base.
