-- ---------------------------------------------------------------------
-- Usuarios, vistos desde la plataforma.
--
-- Hasta ahora los usuarios solo se veían DESDE ADENTRO de una cuenta, y por
-- eso alguien que quedaba sin ninguna asignación desaparecía de todas las
-- pantallas: podía iniciar sesión, pero el panel le decía que no pertenece a
-- ningún lado y no había forma de encontrarlo ni de arreglarlo sin entrar a
-- la base a mano.
--
-- Todo por `security definer`: `tenant_users` tiene RLS que exige un
-- `app.tenant_id`, y acá justamente se mira a través de todas las cuentas.
-- Eso NO es una puerta trasera a los datos de los pacientes — estas
-- funciones devuelven usuarios y membresías, nada más.
-- ---------------------------------------------------------------------

create or replace function superadmin_usuarios(
  p_buscar text default null,
  p_limite int  default 25,
  p_offset int  default 0
)
returns table (
  id            uuid,
  email         citext,
  name          text,
  is_superadmin boolean,
  disabled_at   timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz,
  -- Las cuentas a las que pertenece, con su rol en cada una. Un usuario
  -- puede estar en varias: la secretaria que atiende dos sucursales.
  cuentas       jsonb,
  total         bigint
)
language sql security definer set search_path = public as $fn$
  with base as (
    select u.id, u.email, u.name, u.is_superadmin, u.disabled_at,
           u.last_login_at, u.created_at,
           coalesce(
             (select jsonb_agg(jsonb_build_object(
                       'tenantId', t.id, 'nombre', t.name,
                       'slug', t.slug, 'rol', tu.role,
                       'estado', t.status)
                     order by t.name)
                from tenant_users tu
                join tenants t on t.id = tu.tenant_id
               where tu.user_id = u.id),
             '[]'::jsonb
           ) as cuentas
      from users u
     where p_buscar is null
        or inmutable_unaccent(u.name) ilike inmutable_unaccent('%' || p_buscar || '%')
        or u.email ilike '%' || p_buscar || '%'
  )
  select b.*, count(*) over () as total
    from base b
   -- Los que no están en ninguna cuenta van PRIMERO: son el caso que hay que
   -- resolver, y el que hasta ahora no se veía en ningún lado.
   order by (b.cuentas = '[]'::jsonb) desc, b.name
   limit p_limite offset p_offset
$fn$;

revoke all on function superadmin_usuarios(text, int, int) from public;
grant execute on function superadmin_usuarios(text, int, int) to crm_app;

-- ---------------------------------------------------------------------
-- Quitar a un usuario de UNA cuenta. No lo borra.
-- ---------------------------------------------------------------------
create or replace function superadmin_quitar_de_cuenta(
  p_token_hash text,
  p_user_id    uuid,
  p_tenant_id  uuid
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid; v_super boolean; v_rol tenant_role;
begin
  select s.user_id, u.is_superadmin into v_actor, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_actor is null or not coalesce(v_super, false) then
    return false;
  end if;

  select role into v_rol from tenant_users
   where user_id = p_user_id and tenant_id = p_tenant_id;
  if v_rol is null then
    return false;
  end if;

  delete from tenant_users where user_id = p_user_id and tenant_id = p_tenant_id;

  -- Sacarlo tiene que cerrarle la sesión de ESA cuenta. Si no, sigue
  -- navegando adentro con la cookie vieja hasta que expire.
  delete from sessions where user_id = p_user_id and tenant_id = p_tenant_id;

  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (p_tenant_id, v_actor, 'user', 'superadmin.quito_usuario',
          'user', p_user_id::text, jsonb_build_object('rol', v_rol::text));
  return true;
end;
$fn$;

revoke all on function superadmin_quitar_de_cuenta(text, uuid, uuid) from public;
grant execute on function superadmin_quitar_de_cuenta(text, uuid, uuid) to crm_app;

-- ---------------------------------------------------------------------
-- Deshabilitar / habilitar. Es la baja REVERSIBLE, y casi siempre la
-- correcta.
--
-- `verify_login` y `resolve_session` ya exigen `disabled_at is null`, así que
-- deshabilitar corta el acceso en el acto y le cierra las sesiones abiertas,
-- pero el historial de quién hizo qué sigue con su nombre. Borrarlo deja esas
-- filas sin autor para siempre (`audit_log.actor_user_id` es
-- `on delete set null`).
-- ---------------------------------------------------------------------
create or replace function superadmin_habilitar_usuario(
  p_token_hash text,
  p_user_id    uuid,
  p_habilitar  boolean
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid; v_super boolean; v_email citext;
begin
  select s.user_id, u.is_superadmin into v_actor, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_actor is null or not coalesce(v_super, false) then
    return false;
  end if;
  -- Deshabilitarse a uno mismo es quedarse afuera sin forma de volver.
  if v_actor = p_user_id then
    return false;
  end if;

  select email into v_email from users where id = p_user_id;
  if v_email is null then
    return false;
  end if;

  update users
     set disabled_at = case when p_habilitar then null else now() end,
         updated_at = now()
   where id = p_user_id;

  if not p_habilitar then
    delete from sessions where user_id = p_user_id;
  end if;

  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (null, v_actor, 'user',
          case when p_habilitar then 'superadmin.habilito_usuario'
               else 'superadmin.deshabilito_usuario' end,
          'user', p_user_id::text, jsonb_build_object('email', v_email::text));
  return true;
end;
$fn$;

revoke all on function superadmin_habilitar_usuario(text, uuid, boolean) from public;
grant execute on function superadmin_habilitar_usuario(text, uuid, boolean) to crm_app;

-- ---------------------------------------------------------------------
-- Eliminar un usuario definitivamente.
--
-- Pide el mail y lo vuelve a comparar acá, por lo mismo que la baja de una
-- cuenta pide el slug: un reenvío del formulario o un doble clic no tienen
-- pantalla donde confirmar, y el id solo no alcanza para algo irreversible.
-- ---------------------------------------------------------------------
create or replace function superadmin_eliminar_usuario(
  p_token_hash text,
  p_user_id    uuid,
  p_email      text
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid; v_super boolean; v_email citext; v_obj_super boolean; v_ctas jsonb;
begin
  select s.user_id, u.is_superadmin into v_actor, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_actor is null or not coalesce(v_super, false) then
    return false;
  end if;
  if v_actor = p_user_id then
    return false;
  end if;

  select email, is_superadmin into v_email, v_obj_super
    from users where id = p_user_id;
  if v_email is null or v_email is distinct from p_email::citext then
    return false;
  end if;

  -- Otro superadministrador no se borra desde acá. Son los dueños de la
  -- plataforma; sacarse entre sí a un clic de distancia, en la misma tabla
  -- donde se borra a una secretaria, es demasiado fácil. Para eso está
  -- `./crm.sh borrar usuario`, que obliga a entrar al servidor.
  if coalesce(v_obj_super, false) then
    return false;
  end if;

  select coalesce(jsonb_agg(t.slug), '[]'::jsonb) into v_ctas
    from tenant_users tu join tenants t on t.id = tu.tenant_id
   where tu.user_id = p_user_id;

  -- Con tenant_id NULL: el asiento tiene que sobrevivir aunque después se
  -- borre alguna de las cuentas donde estaba.
  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (null, v_actor, 'user', 'superadmin.elimino_usuario',
          'user', p_user_id::text,
          jsonb_build_object('email', v_email::text, 'cuentas', v_ctas));

  delete from users where id = p_user_id;
  return true;
end;
$fn$;

revoke all on function superadmin_eliminar_usuario(text, uuid, text) from public;
grant execute on function superadmin_eliminar_usuario(text, uuid, text) to crm_app;
