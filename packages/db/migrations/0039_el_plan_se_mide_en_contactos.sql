-- =====================================================================
-- EL PLAN SE MIDE EN CONTACTOS ACUMULADOS, NO EN CONVERSACIONES POR MES
-- ---------------------------------------------------------------------
-- Cambio de modelo comercial, no un ajuste. Lo que se vende deja de ser un
-- caudal que se renueva —"300 conversaciones por mes"— y pasa a ser un
-- tamaño: "hasta 300 contactos". Como en Mailchimp: la lista crece, y cuando
-- llega al tope del plan hay que mejorarlo para que entren más.
--
-- Por qué es mejor para este producto: un CRM acumula. El cliente que sumó
-- 300 personas las tiene para siempre y las va a seguir atendiendo el mes que
-- viene, así que un cupo que se vacía todos los meses no describe lo que
-- pasa. Y "cuántos contactos tengo" es un número que el cliente ya conoce y
-- puede ver en su pantalla; "cuántas conversaciones atendió la IA este mes"
-- había que explicárselo.
--
-- CÓMO CORTA, QUE ES LA PARTE IMPORTANTE
-- ---------------------------------------------------------------------
-- No corta la cuenta entera. Corta POR CONTACTO:
--
--   - Los contactos que entran dentro del tope siguen igual, con la IA
--     contestándoles. Alguien que hace tres meses es cliente no se queda sin
--     asistente porque llegó gente nueva.
--   - El contacto 301 de un plan de 300 se crea igual —el mensaje entra, se
--     ve en la bandeja, una persona puede contestarle— pero la IA no lo
--     atiende hasta que mejoren el plan.
--
-- Que el contacto igual se cree no es negociable: del otro lado hay alguien
-- que escribió por WhatsApp. Rechazarlo sería perder el mensaje, que es lo
-- único que este sistema no puede hacer.
--
-- QUÉ ES "ENTRAR DENTRO DEL TOPE"
-- ---------------------------------------------------------------------
-- Por orden de llegada: los primeros `max_contacts` contactos sin archivar,
-- del más viejo al más nuevo. Se calcula, no se guarda en una columna.
--
-- Guardarlo en un `fuera_del_plan boolean` habría sido más rápido de leer y
-- se desactualiza solo: al archivar un contacto, al mejorar el plan, al
-- desarchivar. Cada uno de esos caminos tendría que acordarse de recalcular
-- la marca de todos los demás, y el día que uno se olvide el cliente paga
-- por algo que no recibe. Contar en el momento no se puede desincronizar.
--
-- Los ARCHIVADOS no ocupan lugar, como en Mailchimp. Es lo que hace que el
-- tope se pueda administrar sin llamar a soporte: el que llegó a 300 limpia
-- los que no le sirven y sigue. Y es coherente con la vista de plataforma,
-- que ya contaba los contactos sin los archivados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El tope del plan
-- ---------------------------------------------------------------------
-- Se rellena con el cupo de conversaciones que tenía cada cuenta, que son los
-- mismos números del catálogo (300 en Start, 900 en Pro): nadie cambia de
-- límite con esta migración, cambia qué mide el límite.
alter table tenants add column if not exists max_contacts int;

update tenants
   set max_contacts = ai_monthly_conversation_cap
 where max_contacts is null;

alter table tenants alter column max_contacts set default 300;

comment on column tenants.max_contacts is
  'Cuántos contactos sin archivar entran en el plan. NULL es sin tope. Los '
  'que pasan del tope se crean igual pero la IA no los atiende.';

-- `ai_monthly_conversation_cap` queda pero NO se usa más. No se borra en este
-- deploy a propósito: la regla es que las migraciones sean aditivas en la
-- actualización que cambia el código, así la versión vieja y la nueva
-- conviven un rato y se puede volver atrás. Se borra un deploy después.
comment on column tenants.ai_monthly_conversation_cap is
  'MUERTA desde la 0039: el plan se mide en contactos (max_contacts). Se '
  'deja para poder volver atrás; borrar en un deploy posterior.';

-- ---------------------------------------------------------------------
-- 2. ¿Este contacto entra en el plan?
-- ---------------------------------------------------------------------
-- Cuenta cuántos contactos sin archivar son ANTERIORES a este. Si son menos
-- que el tope, entra.
--
-- El desempate por `id` está para que el orden sea total: dos contactos
-- creados en el mismo milisegundo —una importación— tienen que quedar en un
-- orden estable, o el que está justo en el límite entra y sale solo según
-- cómo salga ordenada la consulta.
create or replace function contacto_dentro_del_plan(p_tenant uuid, p_contacto uuid)
returns boolean
language sql stable as $fn$
  select case
    -- Sin tope (Business): entran todos.
    when (select max_contacts from tenants where id = p_tenant) is null
      then true
    -- Sin contacto no hay a quién ubicar en la fila. Pasa en los grupos, que
    -- no tienen contacto. Devuelve TRUE: dejar sin asistente a alguien
    -- porque no se lo pudo ubicar sería cortar por un problema nuestro y
    -- cobrárselo al cliente.
    when p_contacto is null then true
    else coalesce((
      select count(*) < (select max_contacts from tenants where id = p_tenant)
        from contacts anteriores, contacts este
       where este.id = p_contacto
         and este.tenant_id = p_tenant
         and anteriores.tenant_id = p_tenant
         and anteriores.archived_at is null
         and (anteriores.created_at, anteriores.id)
             < (este.created_at, este.id)
    ), true)
  end
$fn$;

comment on function contacto_dentro_del_plan(uuid, uuid) is
  'Si este contacto entra en el tope de contactos del plan, por orden de '
  'llegada y sin contar archivados. Los que no entran se atienden a mano.';

-- El índice que sostiene esa cuenta. Sin él, cada mensaje entrante haría un
-- recorrido completo de los contactos de la cuenta.
create index if not exists contactos_orden_de_llegada
  on contacts (tenant_id, created_at, id) where archived_at is null;

-- ---------------------------------------------------------------------
-- 3. La vista de plataforma muestra el tope de contactos
-- ---------------------------------------------------------------------
-- `cupo_ia` e `ia_usadas` se quedan: el consumo de IA por mes sigue siendo lo
-- que se mira contra la factura del proveedor. Lo que cambia es que ya no son
-- el límite del plan, y por eso aparece `max_contacts` al lado de la columna
-- de contactos, que es la que ahora manda.
drop function if exists superadmin_resumen(date);

create function superadmin_resumen(p_mes date)
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
  costo_ia      numeric,
  tope_ia       numeric,
  created_at    timestamptz,
  max_users     int,
  max_wa        int,
  cupo_ia       int,
  ia_usadas     int,
  plan_desde    date,
  ciclo_inicio  date,
  ciclo_fin     date,
  ia_ciclo      int,
  max_contactos int
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
                      and (p_mes is null
                           or (r.created_at >= mes_desde(p_mes, t.timezone)
                               and r.created_at < mes_hasta(p_mes, t.timezone)))), 0),
         t.ai_monthly_cost_cap,
         t.created_at,
         t.max_users,
         t.max_wa_accounts,
         t.ai_monthly_conversation_cap,
         coalesce((select count(distinct r.conversation_id)::int from ai_runs r
                    where r.tenant_id = t.id
                      and r.conversation_id is not null
                      and (p_mes is null
                           or (r.created_at >= mes_desde(p_mes, t.timezone)
                               and r.created_at < mes_hasta(p_mes, t.timezone)))), 0),
         t.plan_desde,
         ciclo_desde(t.plan_desde, t.timezone),
         ciclo_hasta(t.plan_desde, t.timezone),
         coalesce((select count(distinct r.conversation_id)::int from ai_runs r
                    where r.tenant_id = t.id
                      and r.conversation_id is not null
                      and r.created_at >= mes_desde(
                            ciclo_desde(t.plan_desde, t.timezone), t.timezone)
                      and r.created_at < mes_desde(
                            ciclo_hasta(t.plan_desde, t.timezone), t.timezone)), 0),
         t.max_contacts
    from tenants t
    left join verticals v on v.code = t.vertical
   order by t.created_at desc
$fn$;

revoke all on function superadmin_resumen(date) from public;
grant execute on function superadmin_resumen(date) to crm_app;

comment on function superadmin_resumen(date) is
  'Resumen de plataforma. El limite del plan es max_contactos contra '
  'contactos. costo_ia e ia_usadas son del mes calendario p_mes (null = '
  'historico) y sirven para mirar contra la factura del proveedor.';

-- ---------------------------------------------------------------------
-- 4. Cambiar el plan: el tope que se edita ahora es el de contactos
-- ---------------------------------------------------------------------
-- El parámetro del cupo de conversaciones se va y entra el de contactos. La
-- columna vieja deja de escribirse: si se siguiera cargando, en tres meses
-- nadie sabría cuál de las dos manda.
drop function if exists superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric, date);

create function superadmin_cambiar_plan(
  p_token_hash   text,
  p_tenant_id    uuid,
  p_plan         text,
  p_max_users    int,
  p_max_wa       int,
  p_max_contacts int,
  p_cost_cap     numeric,
  p_plan_desde   date
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

  if p_plan !~ '^[a-z][a-z0-9-]{1,39}$' then
    return false;
  end if;

  if p_max_users is not null and (p_max_users < 1 or p_max_users > 10000) then
    return false;
  end if;
  if p_max_wa is not null and (p_max_wa < 1 or p_max_wa > 100) then
    return false;
  end if;
  -- Un tope de contactos en 0 dejaría a la cuenta sin asistente para nadie,
  -- que no es un plan sino un error de tipeo. Sin tope se escribe vacío.
  if p_max_contacts is not null
     and (p_max_contacts < 1 or p_max_contacts > 10000000) then
    return false;
  end if;
  if p_cost_cap is not null and (p_cost_cap < 0 or p_cost_cap > 100000) then
    return false;
  end if;
  if p_plan_desde is null
     or p_plan_desde < date '2024-01-01'
     or p_plan_desde > (now() at time zone 'UTC')::date then
    return false;
  end if;

  select name,
         jsonb_build_object(
           'plan', plan, 'max_users', max_users,
           'max_wa_accounts', max_wa_accounts,
           'max_contacts', max_contacts,
           'ai_monthly_cost_cap', ai_monthly_cost_cap,
           'plan_desde', plan_desde)
    into v_nombre, v_antes
    from tenants where id = p_tenant_id;

  if v_nombre is null then
    return false;
  end if;

  update tenants
     set plan = p_plan,
         max_users = p_max_users,
         max_wa_accounts = p_max_wa,
         max_contacts = p_max_contacts,
         ai_monthly_cost_cap = p_cost_cap,
         plan_desde = p_plan_desde,
         updated_at = now()
   where id = p_tenant_id;

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
              'max_contacts', p_max_contacts,
              'ai_monthly_cost_cap', p_cost_cap,
              'plan_desde', p_plan_desde)));
  return true;
end;
$fn$;

revoke all on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric, date) from public;
grant execute on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric, date) to crm_app;

comment on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric, date) is
  'Cambia el plan, sus limites y desde cuando corre. El tercer entero es el '
  'tope de CONTACTOS desde la 0039, ya no el cupo de conversaciones.';
