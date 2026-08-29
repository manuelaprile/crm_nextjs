-- ---------------------------------------------------------------------
-- A quién le toca cada conversación.
--
-- Hasta ahora la bandeja era de todos y de nadie: entraban veinte consultas
-- y las tres personas del equipo miraban la misma lista sin saber cuál
-- estaba contestando el otro. Con un solo operador eso funciona; con dos ya
-- hay mensajes contestados dos veces y mensajes contestados por nadie.
--
-- La asignación va en la CONVERSACIÓN y no en el contacto. Es la regla 2 de
-- CLAUDE.md: la misma persona puede tener un hilo de WhatsApp por un tema y
-- otro de Instagram por otro, y no tienen por qué caerle al mismo.
-- ---------------------------------------------------------------------

alter table conversations
  add column if not exists assigned_user_id uuid references users(id) on delete set null;

comment on column conversations.assigned_user_id is
  'Quién es responsable de contestar este hilo. NULL = sin asignar, que es '
  'el estado normal de lo que recién entra.';

-- Sirve para las dos preguntas que hace la bandeja: "las de fulano" y
-- "las que no tienen dueño". El `where` lo deja del tamaño de lo que se
-- mira: nadie filtra por usuario dentro del archivo.
create index if not exists conversations_asignadas
  on conversations (tenant_id, assigned_user_id)
  where archived_at is null;

-- ---------------------------------------------------------------------
-- El historial de derivaciones.
--
-- Se pidió explícitamente y la razón se entiende sola: cuando una consulta
-- se cae entre dos personas, la única pregunta que importa es quién la tenía
-- y desde cuándo. Sin registro, eso es la palabra de uno contra la del otro.
--
-- Mismo molde que `stage_history`: fila por cambio, con el de antes y el de
-- después. `by_ai` está desde ahora aunque hoy solo escriba una persona —
-- cuando el asistente reparta solo (punto 1 del pedido), la fila tiene que
-- poder distinguirse de una derivación hecha a mano, y agregar la columna
-- después obliga a decidir qué son las viejas.
-- ---------------------------------------------------------------------
create table if not exists conversation_assignments (
  id              bigserial primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  from_user_id    uuid references users(id) on delete set null,
  -- NULL = quedó sin asignar. Devolver un hilo al montón es un movimiento
  -- tan real como pasárselo a alguien, y también hay que poder verlo.
  to_user_id      uuid references users(id) on delete set null,
  changed_by      uuid references users(id) on delete set null,
  by_ai           boolean not null default false,
  reason          text,
  created_at      timestamptz not null default now()
);
create index on conversation_assignments (conversation_id, created_at desc);
create index on conversation_assignments (tenant_id, created_at desc);

comment on table conversation_assignments is
  'Quién pasó qué conversación a quién y cuándo. No se edita ni se borra: '
  'es un registro, no un estado.';

-- ---------------------------------------------------------------------
-- Permisos.
--
-- Leer el historial lo puede hacer cualquiera de la cuenta: saber quién
-- tiene un hilo es justamente lo que evita pisarse. Escribirlo, solo
-- owner/admin, que es el permiso del pedido ("usuario normal: solo recibe
-- conversaciones asignadas, no puede derivarlas").
--
-- Ojo: RLS no distingue columnas, así que esto NO impide que un operador
-- cambie `conversations.assigned_user_id` por un camino que no sea la
-- pantalla. Lo que sí impide es que ese cambio quede sin registrar, y el
-- chequeo de rol de verdad está en `derivarConversacion()`.
-- ---------------------------------------------------------------------
alter table conversation_assignments enable row level security;
alter table conversation_assignments force row level security;

create policy conversation_assignments_read on conversation_assignments
  for select to crm_app
  using (tenant_id = app_tenant_id());

create policy conversation_assignments_write on conversation_assignments
  for insert to crm_app
  with check (tenant_id = app_tenant_id() and app_is_admin());

-- Un historial que se puede reescribir no es un historial.
revoke update, delete on conversation_assignments from crm_app;
grant select, insert on conversation_assignments to crm_app;

-- El worker todavía no escribe acá: hoy no hay reparto automático. La 0002
-- dejó un `alter default privileges` que le regala escritura sobre toda
-- tabla nueva, así que hay que sacárselo a mano (ver el REVOKE de la 0022).
grant select on conversation_assignments to crm_worker;
revoke insert, update, delete on conversation_assignments from crm_worker;
