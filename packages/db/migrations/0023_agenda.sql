-- ---------------------------------------------------------------------
-- Agenda: turnos, visitas, reuniones.
--
-- El CRM sabía con quién hablar y en qué etapa estaba, pero no cuándo lo
-- iban a ver. Eso vivía en la cabeza de la secretaria o en un cuaderno, y es
-- justo el dato que convierte una consulta en un cliente.
--
-- La IA agenda SOLA dentro de los horarios configurados. Esa decisión es la
-- que manda sobre casi todo lo que sigue: si una máquina escribe en la
-- agenda real de un negocio, las garantías no pueden depender de que el
-- código que llama esté bien escrito. Tienen que estar en la base.
-- ---------------------------------------------------------------------

create extension if not exists "btree_gist";  -- superposición por tenant

-- ---------------------------------------------------------------------
-- Configuración de la agenda, una por cuenta.
--
-- Separada de `agent_configs` porque no es lo mismo: aquella es por CANAL y
-- describe cómo contesta el asistente; esta es del negocio y vale igual si
-- el turno lo carga una persona a mano.
-- ---------------------------------------------------------------------
create table agenda_config (
  tenant_id uuid primary key references tenants(id) on delete cascade,

  -- Si la IA puede agendar. Apagado de arranque: que una máquina escriba en
  -- la agenda de un negocio es una decisión del dueño, no un valor por
  -- defecto que se descubre cuando ya hay un turno puesto.
  ia_agenda boolean not null default false,

  -- Cuánto dura un turno que agenda la IA.
  --
  -- Los turnos son de duración LIBRE: una persona pone inicio y fin donde
  -- quiere. Pero la IA necesita un número para poder decir "el martes a las
  -- 10" y saber hasta cuándo ocupa. Este es ese número, y solo lo usa ella.
  duracion_ia_min int not null default 30,

  -- Con cuánta anticipación mínima puede agendar la IA, en horas. Sin esto
  -- alguien escribe a las 9:55 y le da un turno a las 10:00.
  anticipacion_horas int not null default 2,

  -- Hasta cuántos días para adelante ofrece. Un turno a seis meses no lo
  -- quiere nadie, y menos puesto por un asistente.
  horizonte_dias int not null default 30,

  -- Horarios de atención, por día de la semana (0 = domingo, ISO de JS).
  --   {"1": [["09:00","13:00"],["16:00","20:00"]], "6": [], ...}
  -- Un día sin entrada o con lista vacía es un día cerrado.
  horarios jsonb not null default '{}'::jsonb,

  -- A qué etapa pasa el contacto cuando se le agenda algo.
  --
  -- Apunta a una etapa DE ESTE cliente y puede quedar en null. Las etapas
  -- las define cada cuenta (ver CLAUDE.md: el pipeline es la primitiva que
  -- hace multi-vertical al producto), así que "Interesado" es el nombre que
  -- eligió uno de ellos, no una constante del sistema. `on delete set null`
  -- y no cascade: borrar una etapa no puede llevarse la configuración.
  etapa_al_agendar uuid references stages(id) on delete set null,

  -- Cuándo tiene que ofrecer turno la IA. Mismo formato que
  -- `agent_configs.handoff_keywords`, que ya se carga desde el panel.
  palabras_clave text[] not null default '{}',

  updated_at timestamptz not null default now()
);
create trigger agenda_config_touch before update on agenda_config
  for each row execute function touch_updated_at();

comment on table agenda_config is
  'Cómo funciona la agenda de una cuenta: si la IA puede agendar, en qué '
  'horarios, y a qué etapa pasa el contacto cuando se agenda.';

-- ---------------------------------------------------------------------
-- Los turnos.
-- ---------------------------------------------------------------------
create type appointment_status as enum (
  'programada',   -- en pie
  'cumplida',     -- vino
  'ausente',      -- no vino: es un dato comercial, no un borrado
  'cancelada'
);

create table appointments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,

  -- El contacto puede faltar: una reunión con un proveedor o un bloqueo de
  -- agenda no tienen contacto y no por eso dejan de ocupar el horario.
  contact_id      uuid references contacts(id) on delete set null,
  -- De qué conversación salió, si salió de una. Sirve para volver al hilo
  -- desde la agenda, que es lo primero que alguien quiere hacer al ver un
  -- turno que no cargó.
  conversation_id uuid references conversations(id) on delete set null,

  titulo     text not null,
  -- Texto libre y no una tabla de tipos: para un consultorio es "consulta",
  -- para una inmobiliaria "visita a la propiedad". Una lista fija sería otra
  -- cosa hardcodeada por rubro.
  tipo       text,
  notas      text,

  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     appointment_status not null default 'programada',

  -- Quién lo creó. `creado_por_ia` no se deduce de `creado_por is null`: un
  -- turno cargado por un script tampoco tiene usuario, y en la pantalla hay
  -- que poder decir "esto lo puso el asistente".
  creado_por     uuid references users(id) on delete set null,
  creado_por_ia  boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint appointments_orden check (ends_at > starts_at),
  -- Un turno de doce horas es un error de carga, no una reunión larga.
  constraint appointments_largo check (ends_at - starts_at <= interval '12 hours')
);
create trigger appointments_touch before update on appointments
  for each row execute function touch_updated_at();

create index on appointments (tenant_id, starts_at);
create index on appointments (contact_id, starts_at desc);

-- ---------------------------------------------------------------------
-- Dos turnos no se pueden pisar. Y esto va en la BASE.
--
-- La verificación en el código no alcanza y no es una precaución teórica:
-- la IA agenda sola, o sea que puede haber dos conversaciones distintas
-- pidiendo el mismo horario en el mismo segundo. Entre el "¿está libre?" y
-- el "insertá" hay una ventana, y con dos procesos entra el mismo turno dos
-- veces. Cuando eso pasa se descubre el día del turno, con dos personas en
-- la puerta.
--
-- `exclude using gist` lo resuelve donde no hay ventana posible: Postgres
-- rechaza el segundo insert. `btree_gist` es lo que permite mezclar la
-- igualdad de tenant_id con el solapamiento de rangos en un mismo índice.
--
-- Solo cuenta lo que está en pie: un turno cancelado no ocupa horario.
-- El rango es [inicio, fin) —abierto al final— para que un turno de 10 a 11
-- y otro de 11 a 12 no se consideren superpuestos.
-- ---------------------------------------------------------------------
alter table appointments add constraint appointments_sin_superposicion
  exclude using gist (
    tenant_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('programada', 'cumplida'));

comment on constraint appointments_sin_superposicion on appointments is
  'Dos turnos en pie no pueden pisarse. Está en la base y no en el código '
  'porque la IA agenda sola: dos conversaciones simultáneas pueden pedir el '
  'mismo horario, y entre consultar y grabar hay una ventana.';

-- ---------------------------------------------------------------------
-- Permisos.
--
-- La agenda SÍ la escribe el panel: cargar un turno a mano es la operación
-- más normal del día. Lo que no se toca desde el panel es la configuración
-- de otra cuenta, y de eso se ocupa RLS.
--
-- El worker escribe `appointments` porque el agente corre por ese camino
-- (withSystem), pero NO la configuración: la IA no se cambia sus propios
-- horarios ni se activa sola.
-- ---------------------------------------------------------------------
alter table appointments enable row level security;
alter table agenda_config enable row level security;

create policy appointments_rw on appointments
  for all to crm_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

create policy agenda_config_read on agenda_config
  for select to crm_app
  using (tenant_id = app_tenant_id());

-- Solo owner/admin configuran la agenda. Un operador carga turnos, no define
-- los horarios del negocio ni prende la IA.
create policy agenda_config_write on agenda_config
  for all to crm_app
  using (tenant_id = app_tenant_id() and app_is_admin())
  with check (tenant_id = app_tenant_id() and app_is_admin());

grant select, insert, update, delete on appointments to crm_app;
grant select, insert, update, delete on agenda_config to crm_app;

-- El worker: turnos sí, configuración solo lectura. Ver el REVOKE de la
-- 0022 sobre por qué esto hay que escribirlo: la 0002 dejó un
-- `alter default privileges` que le regala escritura sobre toda tabla nueva.
grant select, insert, update, delete on appointments to crm_worker;
grant select on agenda_config to crm_worker;
revoke insert, update, delete on agenda_config from crm_worker;
