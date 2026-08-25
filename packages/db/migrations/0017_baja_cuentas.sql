-- ---------------------------------------------------------------------
-- Suspender, reactivar y eliminar una cuenta, desde el panel de plataforma.
--
-- Hasta ahora la única forma era `./crm.sh borrar cuenta <slug>`, por SSH.
-- Para dar de baja a un cliente que dejó de pagar eso es demasiado: hay que
-- entrar al servidor.
--
-- Va por funciones `security definer` y no por un UPDATE del panel a propósito.
-- La 0014 le sacó a `crm_app` el permiso de escribir `status` —justamente para
-- que nadie se cambie el plan o se reactive solo— y eso NO se toca: la única
-- puerta es esta, que verifica que quien llama sea superadmin de verdad, con
-- su token de sesión, y deja constancia.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Suspender / reactivar.
--
-- `resolve_session` ya exige que el tenant esté en ('trial','active'), así
-- que suspender corta el acceso al panel de esa cuenta de inmediato: sus
-- usuarios dejan de tener sesión válida. Y las rutas de ingesta filtran por
-- lo mismo, así que tampoco entran mensajes nuevos. Nada se borra.
-- ---------------------------------------------------------------------
create or replace function superadmin_cambiar_estado(
  p_token_hash text,
  p_tenant_id  uuid,
  p_estado     tenant_status
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_user   uuid;
  v_super  boolean;
  v_actual uuid;
  v_previo tenant_status;
  v_nombre text;
begin
  select s.user_id, u.is_superadmin, s.tenant_id
    into v_user, v_super, v_actual
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return false;
  end if;

  -- No se puede suspender la cuenta en la que uno está parado.
  --
  -- `resolve_session` dejaría de devolver la sesión en el acto y el
  -- superadmin quedaría afuera de TODO el panel, sin poder volver a entrar a
  -- esa cuenta para revertirlo —`superadmin_entrar` tampoco acepta cuentas
  -- suspendidas—. Se recupera volviendo a iniciar sesión, pero es un susto
  -- innecesario y desde afuera parece que el sistema se rompió.
  if v_actual = p_tenant_id and p_estado not in ('trial','active') then
    return false;
  end if;

  select status, name into v_previo, v_nombre from tenants where id = p_tenant_id;
  if v_previo is null then
    return false;
  end if;

  update tenants set status = p_estado, updated_at = now() where id = p_tenant_id;

  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (p_tenant_id, v_user, 'user', 'superadmin.cambio_estado',
          'tenant', p_tenant_id::text,
          jsonb_build_object('nombre', v_nombre,
                             'de', v_previo::text, 'a', p_estado::text));
  return true;
end;
$fn$;

revoke all on function superadmin_cambiar_estado(text, uuid, tenant_status) from public;
grant execute on function superadmin_cambiar_estado(text, uuid, tenant_status) to crm_app;

-- ---------------------------------------------------------------------
-- Eliminar una cuenta y TODOS sus datos.
--
-- Es la operación más destructiva del sistema: se lleva en cascada
-- contactos, conversaciones, mensajes, notas y la sesión de WhatsApp. No hay
-- papelera.
--
-- Por eso el slug va como parámetro y tiene que coincidir. Que la
-- confirmación viva también acá, y no solo en la pantalla, es lo que hace que
-- un formulario reenviado, un doble clic o un `curl` a mano no puedan borrar
-- la cuenta equivocada: el id solo no alcanza.
-- ---------------------------------------------------------------------
create or replace function superadmin_eliminar_cuenta(
  p_token_hash text,
  p_tenant_id  uuid,
  p_slug       text
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_user    uuid;
  v_super   boolean;
  v_actual  uuid;
  v_slug    text;
  v_nombre  text;
  v_conteo  jsonb;
begin
  select s.user_id, u.is_superadmin, s.tenant_id
    into v_user, v_super, v_actual
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return false;
  end if;

  -- Tampoco se borra la cuenta en la que uno está adentro.
  if v_actual = p_tenant_id then
    return false;
  end if;

  select slug, name into v_slug, v_nombre from tenants where id = p_tenant_id;
  if v_slug is null or v_slug is distinct from p_slug then
    return false;
  end if;

  -- Qué se llevó por delante, contado ANTES de borrar.
  select jsonb_build_object(
           'slug', v_slug,
           'nombre', v_nombre,
           'contactos',      (select count(*) from contacts      where tenant_id = p_tenant_id),
           'conversaciones', (select count(*) from conversations where tenant_id = p_tenant_id),
           'mensajes',       (select count(*) from messages      where tenant_id = p_tenant_id),
           'usuarios',       (select count(*) from tenant_users  where tenant_id = p_tenant_id)
         )
    into v_conteo;

  -- El registro va con tenant_id NULL a propósito.
  --
  -- `audit_log.tenant_id` tiene `on delete cascade`: escrito con el id de la
  -- cuenta, el asiento de la eliminación se borraría junto con ella y no
  -- quedaría ninguna constancia de que existió. Justo la fila que más importa
  -- conservar. Los datos van en `diff`.
  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (null, v_user, 'user', 'superadmin.elimino_cuenta',
          'tenant', p_tenant_id::text, v_conteo);

  delete from tenants where id = p_tenant_id;
  return true;
end;
$fn$;

revoke all on function superadmin_eliminar_cuenta(text, uuid, text) from public;
grant execute on function superadmin_eliminar_cuenta(text, uuid, text) to crm_app;
