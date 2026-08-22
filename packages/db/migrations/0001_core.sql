-- =====================================================================
-- CRM MULTICANAL POR VERTICALES — NÚCLEO
-- Postgres 16. Ver CLAUDE.md para el modelo conceptual y las reglas duras.
-- ---------------------------------------------------------------------
-- Regla de oro: TODA tabla de negocio lleva tenant_id y RLS.
-- El tenant_id sale de current_setting('app.tenant_id'), nunca del request.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";    -- búsqueda de contactos
create extension if not exists "unaccent";   -- búsqueda sin tildes
create extension if not exists "citext";     -- emails case-insensitive

-- ---------------------------------------------------------------------
-- Helper: el tenant del request actual. El `true` es para que no explote
-- cuando no está seteado (rutas de superadmin, worker, migraciones).
-- ---------------------------------------------------------------------
create or replace function app_tenant_id() returns uuid
language sql stable as $fn$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$fn$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $fn$
begin new.updated_at = now(); return new; end
$fn$;

-- =====================================================================
-- 1. IDENTIDAD Y TENANTS
-- =====================================================================

create type tenant_status   as enum ('trial','active','past_due','suspended','cancelled');
create type tenant_vertical as enum ('medico','ecommerce','colegio','generico');
create type tenant_role     as enum ('owner','admin','agent');

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique,
  name           text not null,
  password_hash  text,
  avatar_url     text,
  is_superadmin  boolean not null default false,
  last_login_at  timestamptz,
  disabled_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger users_touch before update on users
  for each row execute function touch_updated_at();

create table tenants (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  vertical       tenant_vertical not null default 'generico',
  status         tenant_status not null default 'trial',
  plan           text not null default 'starter',
  timezone       text not null default 'America/Argentina/Buenos_Aires',
  locale         text not null default 'es-AR',
  -- Límites del plan. La IA sin tope es un agujero en el margen: ver CLAUDE.md.
  max_users            int not null default 3,
  max_wa_accounts      int not null default 1,
  ai_monthly_cost_cap  numeric(10,2) not null default 20.00,
  trial_ends_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger tenants_touch before update on tenants
  for each row execute function touch_updated_at();

create table tenant_users (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       tenant_role not null default 'agent',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index on tenant_users (user_id);

-- =====================================================================
-- 2. PIPELINE — la primitiva que hace multi-vertical al producto
-- =====================================================================

create table stages (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  key        text not null,               -- estable, para reportes y seeds
  name       text not null,               -- editable por el cliente
  color      text not null default '#6B7280',
  position   int  not null default 0,
  is_initial boolean not null default false,  -- donde caen los contactos nuevos
  is_won     boolean not null default false,  -- "se operó" / "compró" / "se inscribió"
  is_lost    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);
create index on stages (tenant_id, position);
-- Exactamente una etapa inicial por tenant.
create unique index stages_one_initial on stages (tenant_id) where is_initial;

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  display_name  text not null,
  phone         text,                      -- atributo, NO la identidad
  email         citext,
  city          text,                      -- "de qué zona son" — pedido del doctor
  province      text,
  source        text,                      -- whatsapp | instagram | manual | import
  stage_id      uuid references stages(id) on delete set null,
  stage_since   timestamptz not null default now(),
  owner_user_id uuid references users(id) on delete set null,
  last_activity_at timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger contacts_touch before update on contacts
  for each row execute function touch_updated_at();
create index on contacts (tenant_id, stage_id) where archived_at is null;
create index on contacts (tenant_id, last_activity_at desc);
create index on contacts (tenant_id, city);
create index contacts_name_trgm on contacts using gin (display_name gin_trgm_ops);
create index on contacts (tenant_id, phone) where phone is not null;

-- La identidad real: (canal, id externo). Ver regla 3 en CLAUDE.md.
create table contact_identities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  channel     text not null,               -- whatsapp | instagram | facebook
  external_id text not null,               -- JID de WhatsApp / IGSID / PSID
  handle      text,                        -- @usuario o teléfono formateado
  created_at  timestamptz not null default now(),
  unique (tenant_id, channel, external_id)
);
create index on contact_identities (contact_id);

-- Historial de etapas: de acá sale TODO el reporte de embudo.
create table stage_history (
  id            bigserial primary key,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  from_stage_id uuid references stages(id) on delete set null,
  to_stage_id   uuid not null references stages(id) on delete cascade,
  changed_by    uuid references users(id) on delete set null,
  by_ai         boolean not null default false,
  reason        text,
  created_at    timestamptz not null default now()
);
create index on stage_history (tenant_id, created_at desc);
create index on stage_history (contact_id, created_at desc);

create table tags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  color      text not null default '#6B7280',
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table contact_tags (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);
create index on contact_tags (tag_id);

create table notes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  contact_id     uuid not null references contacts(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  by_ai          boolean not null default false,
  body           text not null,
  created_at     timestamptz not null default now()
);
create index on notes (contact_id, created_at desc);

-- Campos custom por vertical, sin tocar el schema por cliente.
create table custom_field_defs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  key        text not null,
  label      text not null,
  type       text not null default 'text',  -- text|number|date|select|multiselect|bool
  options    jsonb not null default '[]'::jsonb,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table custom_field_values (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id   uuid not null references custom_field_defs(id) on delete cascade,
  value      jsonb,
  primary key (contact_id, field_id)
);

-- =====================================================================
-- 3. MENSAJERÍA
-- =====================================================================

create type wa_conn_status as enum
  ('disconnected','qr_pending','connecting','connected','logged_out','banned');
create type msg_direction  as enum ('inbound','outbound');
create type msg_status     as enum ('pending','sent','delivered','read','failed');
create type msg_sender     as enum ('contact','ai','operator','system');

-- Cuentas conectadas del proveedor. El id externo rutea todo lo que entra.
create table channel_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  channel       text not null default 'whatsapp',
  provider      text not null default 'baileys',
  external_id   text,                     -- JID propio; null hasta el primer login
  label         text not null default 'Principal',
  phone         text,
  status        wa_conn_status not null default 'disconnected',
  qr            text,                     -- QR vigente, efímero
  qr_expires_at timestamptz,
  last_error    text,
  connected_at  timestamptz,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger channel_accounts_touch before update on channel_accounts
  for each row execute function touch_updated_at();
-- Clave de ruteo del inbound. Parcial porque external_id es null antes del login.
create unique index channel_accounts_external
  on channel_accounts (provider, external_id) where external_id is not null;
create index on channel_accounts (tenant_id);

-- Auth state de Baileys en Postgres, NO en disco. Ver CLAUDE.md.
create table wa_session_keys (
  account_id uuid not null references channel_accounts(id) on delete cascade,
  key_id     text not null,               -- 'creds' | 'app-state-sync-key-xxx' | ...
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, key_id)
);

create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  channel            text not null,
  provider           text not null,
  account_id         uuid not null references channel_accounts(id) on delete cascade,
  external_id        text not null,        -- JID del hilo
  contact_id         uuid references contacts(id) on delete set null,
  participant_name   text,
  participant_handle text,
  participant_phone  text,
  participant_picture text,
  last_message_at    timestamptz,
  last_inbound_at    timestamptz,
  unread_count       int not null default 0,   -- columna, no COUNT por fila
  ai_enabled         boolean not null default true,
  is_group           boolean not null default false,
  archived_at        timestamptz,
  metadata           jsonb not null default '{}'::jsonb,  -- atribución de anuncio
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger conversations_touch before update on conversations
  for each row execute function touch_updated_at();
-- Regla dura: único por (provider, external_id). Ver CLAUDE.md.
create unique index conversations_provider_external
  on conversations (provider, external_id);
create index on conversations (tenant_id, last_message_at desc nulls last)
  where archived_at is null;
create index on conversations (contact_id);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  channel         text not null,
  provider        text not null,
  external_id     text,                    -- null hasta que el proveedor lo asigna
  direction       msg_direction not null,
  type            text not null default 'text',  -- text|image|audio|video|document|location
  body            text,
  media_url       text,
  media_mime      text,
  status          msg_status not null default 'pending',
  sender_kind     msg_sender not null,
  sender_user_id  uuid references users(id) on delete set null,
  error           text,
  raw_payload     jsonb,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
-- Regla dura: idempotencia sobre external_id SOLO, parcial. Ver CLAUDE.md.
create unique index messages_external_id_uq
  on messages (external_id) where external_id is not null;
create index on messages (conversation_id, created_at desc);
create index on messages (tenant_id, created_at desc);

-- Idempotencia de la ingesta. Se reclama el evento ANTES de procesarlo.
create table webhook_events (
  event_id     text primary key,
  tenant_id    uuid references tenants(id) on delete cascade,
  provider     text not null,
  kind         text,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);
-- La red de seguridad: eventos reclamados pero nunca procesados.
create index webhook_events_stuck
  on webhook_events (received_at) where processed_at is null;

-- =====================================================================
-- 4. AGENTE DE IA
-- =====================================================================

create table agent_configs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  channel          text not null,
  enabled          boolean not null default false,   -- canales nuevos: APAGADOS
  assistant_name   text not null default 'Asistente',
  system_prompt    text,
  model            text not null default 'claude-haiku-4-5',
  enabled_tools    text[] not null default '{}',
  max_turns        int not null default 8,
  -- Dispara pase a humano inmediato. En médico: dolor, urgencia, sangrado...
  handoff_keywords text[] not null default '{}',
  business_hours   jsonb not null default '{}'::jsonb,
  faq              jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now(),
  unique (tenant_id, channel)
);
create trigger agent_configs_touch before update on agent_configs
  for each row execute function touch_updated_at();

create table ai_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  model           text not null,
  input_tokens        int not null default 0,
  output_tokens       int not null default 0,
  cache_read_tokens   int not null default 0,
  cache_write_tokens  int not null default 0,
  cost_usd        numeric(10,6) not null default 0,
  duration_ms     int,
  stop_reason     text,
  error           text,
  created_at      timestamptz not null default now()
);
create index on ai_runs (tenant_id, created_at desc);

create table ai_tool_calls (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  run_id          uuid references ai_runs(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  tool_name       text not null,
  input           jsonb,
  output          jsonb,
  error           text,
  duration_ms     int,
  created_at      timestamptz not null default now()
);
create index on ai_tool_calls (tenant_id, created_at desc);

-- =====================================================================
-- 5. AUDITORÍA
-- =====================================================================

create table audit_log (
  id             bigserial primary key,
  tenant_id      uuid references tenants(id) on delete cascade,
  actor_user_id  uuid references users(id) on delete set null,
  actor_kind     text not null default 'user',   -- user | ai | system
  action         text not null,                  -- contact.stage_changed, wa.disconnected
  entity         text,
  entity_id      text,
  diff           jsonb,
  ip             inet,
  created_at     timestamptz not null default now()
);
create index on audit_log (tenant_id, created_at desc);
create index on audit_log (entity, entity_id);
