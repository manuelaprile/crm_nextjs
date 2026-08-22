-- =====================================================================
-- RESUMEN PARA EL SUPERADMINISTRADOR
-- ---------------------------------------------------------------------
-- El superadmin necesita ver el estado de TODOS los consultorios, pero eso
-- choca de frente con RLS, que existe justamente para que nadie vea lo de
-- otro.
--
-- La salida no es darle acceso a las tablas: es una función `security
-- definer` que devuelve SOLO NÚMEROS AGREGADOS. Cuántos contactos, cuántas
-- conversaciones, cuánto gastó de IA. Ningún nombre de paciente, ningún
-- teléfono, ningún mensaje.
--
-- Si algún día hace falta que el superadmin entre a un consultorio concreto
-- (para dar soporte), eso se hace asignándolo como usuario de ese
-- consultorio y queda registrado en tenant_users. No por una puerta trasera.
-- =====================================================================

create or replace function superadmin_resumen()
returns table (
  id            uuid,
  slug          text,
  name          text,
  vertical      tenant_vertical,
  status        tenant_status,
  plan          text,
  usuarios      int,
  contactos     int,
  conversaciones int,
  costo_ia_mes  numeric,
  tope_ia       numeric,
  created_at    timestamptz
)
language sql security definer set search_path = public as $fn$
  select t.id, t.slug, t.name, t.vertical, t.status, t.plan,
         (select count(*)::int from tenant_users tu where tu.tenant_id = t.id),
         (select count(*)::int from contacts c
           where c.tenant_id = t.id and c.archived_at is null),
         (select count(*)::int from conversations cv where cv.tenant_id = t.id),
         coalesce((select sum(r.cost_usd) from ai_runs r
                    where r.tenant_id = t.id
                      and r.created_at >= date_trunc('month', now())), 0),
         t.ai_monthly_cost_cap,
         t.created_at
    from tenants t
   order by t.created_at desc
$fn$;

revoke all on function superadmin_resumen() from public;
grant execute on function superadmin_resumen() to crm_app;

-- ---------------------------------------------------------------------
-- Alta de consultorio desde el panel de superadmin.
-- Crea el consultorio, aplica la plantilla del vertical y deja al usuario
-- indicado como dueño. Todo en una transacción.
-- ---------------------------------------------------------------------
create or replace function superadmin_crear_consultorio(
  p_slug text, p_nombre text, p_vertical tenant_vertical,
  p_email citext, p_nombre_usuario text, p_clave text
) returns uuid
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_tenant uuid; v_user uuid;
begin
  insert into tenants (slug, name, vertical, status)
  values (p_slug, p_nombre, p_vertical, 'trial')
  returning id into v_tenant;

  if p_vertical = 'medico' then
    perform seed_vertical_medico(v_tenant);
  end if;

  insert into users (email, name) values (p_email, p_nombre_usuario)
  on conflict (email) do update set name = excluded.name
  returning id into v_user;

  perform set_user_password(v_user, p_clave);

  insert into tenant_users (tenant_id, user_id, role)
  values (v_tenant, v_user, 'owner')
  on conflict (tenant_id, user_id) do update set role = 'owner';

  return v_tenant;
end
$fn$;

revoke all on function superadmin_crear_consultorio(text, text, tenant_vertical, citext, text, text) from public;
grant execute on function superadmin_crear_consultorio(text, text, tenant_vertical, citext, text, text) to crm_app;
