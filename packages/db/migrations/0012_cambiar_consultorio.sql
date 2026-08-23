-- =====================================================================
-- CAMBIO DE CONSULTORIO ACTIVO
-- ---------------------------------------------------------------------
-- Dos casos distintos:
--
-- 1. Un usuario normal que pertenece a VARIOS consultorios y quiere pasar
--    de uno a otro. Ya existía `switch_tenant`, que valida la membresía.
--
-- 2. Un SUPERADMIN que necesita entrar a un consultorio para dar soporte,
--    sin pertenecer a él.
--
-- El segundo es acceso a datos de pacientes, así que se trata como tal:
--   - Queda registrado en audit_log, con quién entró y cuándo.
--   - El panel muestra un aviso permanente mientras está adentro.
--   - No se toca tenant_users: el superadmin sigue sin ser miembro, así
--     que no aparece en la lista de usuarios del consultorio ni recibe
--     nada. Es una visita, no un alta encubierta.
-- =====================================================================

-- Un superadmin con un consultorio activo opera como dueño de ese
-- consultorio aunque no figure en tenant_users. Sin esto, entra pero el
-- panel lo rechaza por no tener rol.
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
         s.tenant_id,
         case
           when tu.role is not null then tu.role
           when u.is_superadmin and s.tenant_id is not null then 'owner'::tenant_role
           else null
         end,
         t.name, t.vertical, s.last_used_at
    from sessions s
    join users u on u.id = s.user_id
    left join tenant_users tu
      on tu.user_id = s.user_id and tu.tenant_id = s.tenant_id
    left join tenants t on t.id = s.tenant_id
   where s.token_hash = p_token_hash
     and s.expires_at > now()
     and u.disabled_at is null
     and (t.id is null or t.status in ('trial','active'))
$fn$;

revoke all on function resolve_session(text) from public;
grant execute on function resolve_session(text) to crm_app;

-- ---------------------------------------------------------------------
-- Entrada de un superadmin a un consultorio cualquiera.
-- Devuelve false si el usuario no es superadmin: no es una puerta abierta.
-- ---------------------------------------------------------------------
create or replace function superadmin_entrar(p_token_hash text, p_tenant_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_user uuid; v_super boolean; v_nombre text;
begin
  select s.user_id, u.is_superadmin into v_user, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return false;
  end if;

  select name into v_nombre from tenants
   where id = p_tenant_id and status in ('trial','active');
  if v_nombre is null then
    return false;
  end if;

  update sessions set tenant_id = p_tenant_id where token_hash = p_token_hash;

  -- El registro es la contrapartida del acceso: si un superadmin entra a
  -- ver datos de pacientes, tiene que quedar constancia.
  insert into audit_log (tenant_id, actor_user_id, actor_kind, action, entity, entity_id, diff)
  values (p_tenant_id, v_user, 'user', 'superadmin.entro_al_consultorio',
          'tenant', p_tenant_id::text,
          jsonb_build_object('consultorio', v_nombre));

  return true;
end
$fn$;

revoke all on function superadmin_entrar(text, uuid) from public;
grant execute on function superadmin_entrar(text, uuid) to crm_app;

-- ---------------------------------------------------------------------
-- Salir del consultorio y volver a la vista de plataforma.
-- ---------------------------------------------------------------------
create or replace function superadmin_salir(p_token_hash text)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_user uuid; v_super boolean;
begin
  select s.user_id, u.is_superadmin into v_user, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return false;
  end if;

  update sessions set tenant_id = null where token_hash = p_token_hash;
  return true;
end
$fn$;

revoke all on function superadmin_salir(text) from public;
grant execute on function superadmin_salir(text) to crm_app;
