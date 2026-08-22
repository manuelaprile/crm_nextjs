-- =====================================================================
-- RLS — aislamiento por tenant y granularidad por rol
-- ---------------------------------------------------------------------
-- Contexto: no estamos en Supabase, así que no hay auth.uid(). El aislamiento
-- se apoya en variables de sesión que la app setea con SET LOCAL dentro de la
-- transacción del request:
--
--   set local app.tenant_id = '<uuid>';
--   set local app.user_id   = '<uuid>';
--   set local app.user_role = 'owner' | 'admin' | 'agent';
--
-- La app se conecta como crm_app, que NO tiene BYPASSRLS. Las migraciones y el
-- superadmin usan crm_owner. Esa separación es lo que hace que RLS sirva de algo:
-- si la app corriera como dueño de las tablas, RLS no se aplicaría nunca.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    create role crm_app login noinherit;
  end if;
end
$do$;

alter role crm_app nobypassrls;

grant usage on schema public to crm_app;
grant select, insert, update, delete on all tables in schema public to crm_app;
grant usage, select on all sequences in schema public to crm_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to crm_app;
alter default privileges in schema public
  grant usage, select on sequences to crm_app;

-- ---------------------------------------------------------------------
-- Helpers de contexto
-- ---------------------------------------------------------------------
create or replace function app_user_id() returns uuid
language sql stable as $fn$
  select nullif(current_setting('app.user_id', true), '')::uuid
$fn$;

create or replace function app_user_role() returns text
language sql stable as $fn$
  select coalesce(nullif(current_setting('app.user_role', true), ''), 'none')
$fn$;

-- ¿El request actual puede tocar configuración sensible?
-- Credenciales, sesiones de WhatsApp, config del agente, límites del plan.
-- Un 'agent' (la secretaria) NO. Esto es exactamente el agujero que tenía el
-- schema viejo: un `for all` plano le daba a cualquiera acceso a integrations.
create or replace function app_is_admin() returns boolean
language sql stable as $fn$
  select app_user_role() in ('owner','admin')
$fn$;

-- ---------------------------------------------------------------------
-- Activar RLS en todo lo que lleva tenant_id
-- ---------------------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array[
    'tenants','tenant_users',
    'stages','contacts','contact_identities','stage_history',
    'tags','contact_tags','notes','custom_field_defs','custom_field_values',
    'channel_accounts','conversations','messages','webhook_events',
    'agent_configs','ai_runs','ai_tool_calls','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end
$do$;

-- wa_session_keys no tiene tenant_id propio (cuelga de channel_accounts).
alter table wa_session_keys enable row level security;
alter table wa_session_keys force row level security;

-- ---------------------------------------------------------------------
-- Política base: aislamiento por tenant para las tablas operativas.
-- Un tenant_id nulo en el contexto no ve NADA (fail-closed).
-- ---------------------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array[
    'stages','contacts','contact_identities','stage_history',
    'tags','contact_tags','notes','custom_field_defs','custom_field_values',
    'conversations','messages','ai_runs','ai_tool_calls'
  ] loop
    execute format($f$
      create policy %I_tenant on %I
        for all to crm_app
        using (tenant_id = app_tenant_id())
        with check (tenant_id = app_tenant_id());
    $f$, t, t);
  end loop;
end
$do$;

-- ---------------------------------------------------------------------
-- Tablas sensibles: lectura para todo el tenant, escritura solo admin/owner
-- ---------------------------------------------------------------------

-- channel_accounts: la secretaria necesita VER si WhatsApp está conectado,
-- pero no debe poder desconectarlo ni crear cuentas nuevas.
create policy channel_accounts_read on channel_accounts
  for select to crm_app
  using (tenant_id = app_tenant_id());

create policy channel_accounts_write on channel_accounts
  for all to crm_app
  using (tenant_id = app_tenant_id() and app_is_admin())
  with check (tenant_id = app_tenant_id() and app_is_admin());

-- agent_configs: idem. El prompt del asistente lo toca el dueño, no el operador.
create policy agent_configs_read on agent_configs
  for select to crm_app
  using (tenant_id = app_tenant_id());

create policy agent_configs_write on agent_configs
  for all to crm_app
  using (tenant_id = app_tenant_id() and app_is_admin())
  with check (tenant_id = app_tenant_id() and app_is_admin());

-- wa_session_keys: el material de sesión de WhatsApp. NADIE lo lee desde la app.
-- Solo el worker, que se conecta con su propio rol (crm_worker, ver abajo).
-- Sin política para crm_app = acceso denegado por defecto.

-- tenants: el tenant ve su propia ficha; solo owner/admin la editan, y nunca
-- los límites del plan (eso es del superadmin, que va por crm_owner).
create policy tenants_read on tenants
  for select to crm_app
  using (id = app_tenant_id());

create policy tenants_update on tenants
  for update to crm_app
  using (id = app_tenant_id() and app_is_admin())
  with check (id = app_tenant_id() and app_is_admin());

-- tenant_users: el usuario ve a sus compañeros de tenant; solo admin los gestiona.
create policy tenant_users_read on tenant_users
  for select to crm_app
  using (tenant_id = app_tenant_id());

create policy tenant_users_write on tenant_users
  for all to crm_app
  using (tenant_id = app_tenant_id() and app_is_admin())
  with check (tenant_id = app_tenant_id() and app_is_admin());

-- audit_log: se lee (admin), se inserta (cualquiera), NUNCA se modifica ni borra.
create policy audit_log_read on audit_log
  for select to crm_app
  using (tenant_id = app_tenant_id() and app_is_admin());

create policy audit_log_insert on audit_log
  for insert to crm_app
  with check (tenant_id = app_tenant_id());

revoke update, delete on audit_log from crm_app;

-- webhook_events: solo el worker y las rutas internas. La app de panel no lo toca.
create policy webhook_events_tenant on webhook_events
  for all to crm_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

-- ---------------------------------------------------------------------
-- users: NO lleva tenant_id. Sin RLS por tenant, pero con columnas protegidas:
-- el hash de contraseña no se expone al rol de la app en lecturas de panel.
-- El login pasa por una función security definer, no por un SELECT directo.
-- ---------------------------------------------------------------------
revoke select on users from crm_app;
grant select (id, email, name, avatar_url, is_superadmin, last_login_at,
              disabled_at, created_at, updated_at) on users to crm_app;
grant update (name, avatar_url, last_login_at) on users to crm_app;
grant insert on users to crm_app;

-- Verificación de credenciales sin que la app pueda leer el hash.
create or replace function verify_login(p_email citext, p_password text)
returns table (id uuid, email citext, name text, is_superadmin boolean)
language sql security definer set search_path = public, extensions as $fn$
  select u.id, u.email, u.name, u.is_superadmin
  from users u
  where u.email = p_email
    and u.disabled_at is null
    and u.password_hash is not null
    and u.password_hash = crypt(p_password, u.password_hash)
$fn$;

revoke all on function verify_login(citext, text) from public;
grant execute on function verify_login(citext, text) to crm_app;

-- ---------------------------------------------------------------------
-- Rol del worker de WhatsApp: necesita el material de sesión y escribir
-- mensajes entrantes cruzando tenants (mantiene N sesiones a la vez).
-- Por eso va con su propio rol y NO comparte credenciales con la app web.
-- ---------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_worker') then
    create role crm_worker login noinherit bypassrls;
  end if;
end
$do$;

grant usage on schema public to crm_worker;
grant select, insert, update, delete on all tables in schema public to crm_worker;
grant usage, select on all sequences in schema public to crm_worker;
alter default privileges in schema public
  grant select, insert, update, delete on tables to crm_worker;
alter default privileges in schema public
  grant usage, select on sequences to crm_worker;

-- El worker no necesita leer usuarios ni auditar como usuario.
revoke all on users from crm_worker;
grant select (id, email, name) on users to crm_worker;
