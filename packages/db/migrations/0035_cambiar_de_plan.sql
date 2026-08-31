-- =====================================================================
-- CAMBIAR DE PLAN DESDE EL PANEL, SIN ENTRAR AL SERVIDOR
-- ---------------------------------------------------------------------
-- Los cuatro límites de una cuenta —usuarios, números, conversaciones de IA
-- y tope de gasto— se cambiaban a mano en la base. Con un plan era
-- tolerable; con tres y clientes que suben de plan, es entrar por SSH cada
-- vez que alguien paga más.
--
-- Va por función `security definer` y NO por un UPDATE del panel, igual que
-- suspender una cuenta. La 0014 le revocó a `crm_app` el update sobre
-- `tenants` y le devolvió solo (name, timezone, locale) — justamente para
-- que un admin no pueda subirse su propio límite. Eso no se toca: la única
-- puerta es esta, que verifica que quien llama sea superadmin de verdad, con
-- su token de sesión, y deja constancia de quién y de qué a qué.
--
-- LOS CUATRO NÚMEROS VIAJAN JUNTOS, no se deduce ninguno del nombre del plan.
-- El catálogo vive en el código (`lib/planes.ts`) y esta función no lo
-- conoce: así una cuenta puede tener una excepción negociada —"Start pero
-- con 5 usuarios"— sin inventar un plan nuevo, y cambiar el catálogo no le
-- cambia los límites a nadie de un día para el otro.
--
-- NULL ES "SIN TOPE" en los tres primeros. Nunca 0, que significaría cero
-- permitido, ni un número gigante, que parece un límite real.
-- =====================================================================

create or replace function superadmin_cambiar_plan(
  p_token_hash text,
  p_tenant_id  uuid,
  p_plan       text,
  p_max_users  int,
  p_max_wa     int,
  p_conv_cap   int,
  p_cost_cap   numeric
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_user   uuid;
  v_super  boolean;
  v_nombre text;
  v_antes  jsonb;
begin
  select s.user_id, u.is_superadmin
    into v_user, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return false;
  end if;

  -- El código del plan va a una columna de texto libre y se muestra en
  -- pantalla: se valida el formato para que no entre cualquier cosa.
  if p_plan !~ '^[a-z][a-z0-9-]{1,39}$' then
    return false;
  end if;

  -- Rangos. No son reglas de negocio, son barreras contra un dedo: un tope
  -- de gasto de un millón por un cero de más no lo atrapa nadie después.
  if p_max_users is not null and (p_max_users < 1 or p_max_users > 10000) then
    return false;
  end if;
  if p_max_wa is not null and (p_max_wa < 1 or p_max_wa > 100) then
    return false;
  end if;
  if p_conv_cap is not null and (p_conv_cap < 0 or p_conv_cap > 1000000) then
    return false;
  end if;
  -- El tope de gasto SÍ puede quedar en null (sin red), pero es una decisión
  -- que tiene que ser explícita y quedar registrada, no un descuido.
  if p_cost_cap is not null and (p_cost_cap < 0 or p_cost_cap > 100000) then
    return false;
  end if;

  select name,
         jsonb_build_object(
           'plan', plan, 'max_users', max_users,
           'max_wa_accounts', max_wa_accounts,
           'ai_monthly_conversation_cap', ai_monthly_conversation_cap,
           'ai_monthly_cost_cap', ai_monthly_cost_cap)
    into v_nombre, v_antes
    from tenants where id = p_tenant_id;

  if v_nombre is null then
    return false;
  end if;

  update tenants
     set plan = p_plan,
         max_users = p_max_users,
         max_wa_accounts = p_max_wa,
         ai_monthly_conversation_cap = p_conv_cap,
         ai_monthly_cost_cap = p_cost_cap,
         updated_at = now()
   where id = p_tenant_id;

  -- Antes Y después. Dentro de tres meses la pregunta va a ser "¿por qué
  -- esta cuenta tiene 5 usuarios si es Start?", y la respuesta tiene que
  -- estar acá con nombre y fecha.
  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (p_tenant_id, v_user, 'user', 'superadmin.cambio_plan',
          'tenant', p_tenant_id::text,
          jsonb_build_object(
            'nombre', v_nombre,
            'antes', v_antes,
            'despues', jsonb_build_object(
              'plan', p_plan, 'max_users', p_max_users,
              'max_wa_accounts', p_max_wa,
              'ai_monthly_conversation_cap', p_conv_cap,
              'ai_monthly_cost_cap', p_cost_cap)));
  return true;
end;
$fn$;

revoke all on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric) from public;
grant execute on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric) to crm_app;

comment on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric) is
  'Cambia el plan y los cuatro límites de una cuenta. Única puerta: crm_app '
  'no tiene update sobre esas columnas y no lo tiene que tener. NULL en los '
  'límites es sin tope.';

-- =====================================================================
-- LA VISTA DE PLATAFORMA TIENE QUE MOSTRAR LO QUE AHORA SE PUEDE CAMBIAR
-- ---------------------------------------------------------------------
-- `superadmin_resumen()` mostraba el gasto de IA contra su tope y nada más.
-- Para poder cambiar un plan desde la pantalla hace falta ver los cuatro
-- límites y, sobre todo, **cuántas conversaciones lleva usadas**: subir a
-- alguien de plan sin ver si está llegando al cupo es adivinar.
--
-- Se agregan columnas al final. Las que ya estaban no se tocan ni se
-- reordenan: la app las lee por nombre, pero un `select *` en otro lado se
-- rompería con un cambio de orden.
-- =====================================================================

drop function if exists superadmin_resumen();

create function superadmin_resumen()
returns table (
  id            uuid,
  slug          text,
  name          text,
  vertical      text,
  rubro         text,
  status        tenant_status,
  plan          text,
  usuarios      int,
  contactos     int,
  conversaciones int,
  costo_ia_mes  numeric,
  tope_ia       numeric,
  created_at    timestamptz,
  max_users     int,
  max_wa        int,
  cupo_ia       int,
  ia_usadas     int
)
language sql security definer set search_path = public as $fn$
  select t.id, t.slug, t.name, t.vertical,
         coalesce(v.singular, t.vertical), t.status, t.plan,
         (select count(*)::int from tenant_users tu where tu.tenant_id = t.id),
         (select count(*)::int from contacts c
           where c.tenant_id = t.id and c.archived_at is null),
         (select count(*)::int from conversations cv where cv.tenant_id = t.id),
         coalesce((select sum(r.cost_usd) from ai_runs r
                    where r.tenant_id = t.id
                      and r.created_at >= date_trunc('month', now())), 0),
         t.ai_monthly_cost_cap,
         t.created_at,
         t.max_users,
         t.max_wa_accounts,
         t.ai_monthly_conversation_cap,
         -- Las conversaciones distintas del mes: la misma cuenta que hace
         -- `cupoDeIa` en el panel del cliente. Si las dos pantallas dieran
         -- números distintos, el soporte sería imposible.
         coalesce((select count(distinct r.conversation_id)::int from ai_runs r
                    where r.tenant_id = t.id
                      and r.conversation_id is not null
                      and r.created_at >= date_trunc('month', now())), 0)
    from tenants t
    left join verticals v on v.code = t.vertical
   order by t.created_at desc
$fn$;

revoke all on function superadmin_resumen() from public;
grant execute on function superadmin_resumen() to crm_app;
