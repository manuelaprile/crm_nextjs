-- =====================================================================
-- RESOLUCIÓN DEL CONTEXTO DE SESIÓN
-- ---------------------------------------------------------------------
-- Problema del huevo y la gallina: para setear app.tenant_id hay que saber a
-- qué consultorio pertenece el usuario, pero `tenant_users` tiene RLS que
-- exige app.tenant_id ya seteado. Sin contexto, la política devuelve cero
-- filas y el login "funciona" pero el usuario queda sin consultorio.
--
-- Se resuelve con una función `security definer` MUY acotada: recibe el hash
-- del token de sesión y devuelve únicamente el contexto de ESE usuario. No
-- es una puerta trasera — no acepta un tenant_id arbitrario, no lista otros
-- usuarios y no expone ninguna tabla de negocio.
-- =====================================================================

create or replace function resolve_session(p_token_hash text)
returns table (
  user_id         uuid,
  email           citext,
  name            text,
  is_superadmin   boolean,
  tenant_id       uuid,
  role            tenant_role,
  tenant_name     text,
  tenant_vertical tenant_vertical,
  last_used_at    timestamptz
)
language sql security definer set search_path = public as $fn$
  select u.id, u.email, u.name, u.is_superadmin,
         s.tenant_id, tu.role, t.name, t.vertical, s.last_used_at
    from sessions s
    join users u on u.id = s.user_id
    left join tenant_users tu
      on tu.user_id = s.user_id and tu.tenant_id = s.tenant_id
    left join tenants t on t.id = s.tenant_id
   where s.token_hash = p_token_hash
     and s.expires_at > now()
     and u.disabled_at is null
     -- Un consultorio suspendido o dado de baja no deja entrar a nadie.
     and (t.id is null or t.status in ('trial','active'))
$fn$;

revoke all on function resolve_session(text) from public;
grant execute on function resolve_session(text) to crm_app;

-- Los consultorios de un usuario, para el selector cuando tiene varios.
create or replace function user_tenants(p_user_id uuid)
returns table (tenant_id uuid, name text, vertical tenant_vertical, role tenant_role)
language sql security definer set search_path = public as $fn$
  select t.id, t.name, t.vertical, tu.role
    from tenant_users tu
    join tenants t on t.id = tu.tenant_id
   where tu.user_id = p_user_id
     and t.status in ('trial','active')
   order by t.name
$fn$;

revoke all on function user_tenants(uuid) from public;
grant execute on function user_tenants(uuid) to crm_app;

-- Cambiar de consultorio activo. Valida la membresía del lado del servidor:
-- mandar un tenant_id al que no pertenecés no hace nada.
create or replace function switch_tenant(p_token_hash text, p_tenant_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_user uuid;
begin
  select user_id into v_user from sessions
   where token_hash = p_token_hash and expires_at > now();
  if v_user is null then return false; end if;

  if not exists (
    select 1 from tenant_users
     where user_id = v_user and tenant_id = p_tenant_id
  ) then
    return false;
  end if;

  update sessions set tenant_id = p_tenant_id where token_hash = p_token_hash;
  return true;
end
$fn$;

revoke all on function switch_tenant(text, uuid) from public;
grant execute on function switch_tenant(text, uuid) to crm_app;

-- Primer consultorio de un usuario, para asignarlo al crear la sesión.
create or replace function first_tenant_for(p_user_id uuid)
returns uuid
language sql security definer set search_path = public as $fn$
  select tu.tenant_id from tenant_users tu
    join tenants t on t.id = tu.tenant_id
   where tu.user_id = p_user_id and t.status in ('trial','active')
   order by tu.created_at limit 1
$fn$;

revoke all on function first_tenant_for(uuid) from public;
grant execute on function first_tenant_for(uuid) to crm_app;
