-- =====================================================================
-- EL CUPO SE RENUEVA EN EL ANIVERSARIO, NO EL 1º
-- ---------------------------------------------------------------------
-- Los planes se cobran por FECHA DE CONTRATACIÓN: el que contrata un 10
-- paga todos los 10. El cupo, en cambio, se renovaba el 1º para todos.
--
-- Eso es un agujero, no un detalle. Quien contrata un 25 tiene sus 300
-- conversaciones hasta fin de mes y el 1º le entran otras 300: 600 adentro
-- del primer mes que pagó. Y en general el período que el cliente pagó y el
-- período del cupo nunca coinciden, así que "te quedan 40 hasta que se
-- renueve" es una frase que no se puede decir con precisión.
--
-- A partir de acá el cupo corre del 10 al 10 de cada cuenta.
--
-- QUÉ SIGUE SIENDO CALENDARIO
-- ---------------------------------------------------------------------
-- El COSTO en la vista de plataforma. Eso no es lo que compró el cliente:
-- es lo que Impulxy le paga al proveedor de IA, y esa factura viene por mes
-- calendario. Mezclarlos haría que la suma de las cuentas no dé nunca lo que
-- dice la factura. Son dos preguntas distintas y cada una conserva su
-- período.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Desde cuándo corre el plan de cada cuenta
-- ---------------------------------------------------------------------
-- Se guarda la FECHA ENTERA y no solo el día del mes. El día se puede sacar
-- de la fecha cuando haga falta, y al revés no: con un `dia_de_cobro = 10`
-- suelto no hay forma de saber si esta cuenta arrancó en marzo o el mes
-- pasado, que es justo lo que se pregunta cuando alguien reclama.
alter table tenants add column if not exists plan_desde date;

-- Las que ya están arrancan el día que se creó la cuenta. Es lo más cerca de
-- la verdad que hay en la base, y para las cuatro cuentas de hoy es exacto:
-- la cuenta se crea cuando el cliente contrata. Si alguna difiere, se
-- corrige desde Plataforma → la cuenta → Plan.
update tenants set plan_desde = created_at::date where plan_desde is null;

alter table tenants alter column plan_desde set not null;
alter table tenants alter column plan_desde set default current_date;

comment on column tenants.plan_desde is
  'Desde cuándo corre el plan. Ancla del ciclo de cupo: si es un 10, el cupo '
  'se renueva todos los 10. NO es la fecha de creación de la cuenta, aunque '
  'para las cuentas viejas se haya rellenado con ella.';

-- ---------------------------------------------------------------------
-- 2. Dónde empieza y termina el ciclo de una cuenta
-- ---------------------------------------------------------------------
-- El problema de los meses cortos: alguien que contrató un 31 no tiene un 31
-- en febrero. Se recorta al último día del mes —28 de febrero— y el mes
-- siguiente vuelve al 31. Por eso el recorte se calcula SIEMPRE contra el
-- ancla original y nunca contra el inicio del ciclo anterior: encadenando
-- desde el 28 de febrero, un cliente que contrató un 31 terminaría cobrando
-- los 28 para siempre.
create or replace function dia_del_ciclo(p_ancla date, p_mes date)
returns date language sql immutable as $fn$
  select p_mes + (least(
           extract(day from p_ancla)::int,
           extract(day from (p_mes + interval '1 month - 1 day'))::int
         ) - 1)
$fn$;

comment on function dia_del_ciclo(date, date) is
  'El día del ciclo dentro de ese mes, recortado al último día si el mes es '
  'más corto que el ancla (un 31 en febrero es el 28).';

/* El ciclo vigente hoy para esa cuenta. "Hoy" es en la zona de la cuenta:
   con la del servidor, un cliente en Argentina vería renovarse el cupo a las
   nueve de la noche del día anterior. */
create or replace function ciclo_desde(p_ancla date, p_zona text)
returns date language sql stable as $fn$
  select case
           when dia_del_ciclo(p_ancla, date_trunc('month', hoy)::date) <= hoy
             then dia_del_ciclo(p_ancla, date_trunc('month', hoy)::date)
           else dia_del_ciclo(p_ancla,
                              (date_trunc('month', hoy) - interval '1 month')::date)
         end
    from (select (now() at time zone p_zona)::date as hoy) t
$fn$;

/* Cuándo se renueva. Fin EXCLUSIVO: el cupo del ciclo que arranca el 10 de
   septiembre cuenta hasta el 10 de octubre a las 00:00, no incluido. */
create or replace function ciclo_hasta(p_ancla date, p_zona text)
returns date language sql stable as $fn$
  select dia_del_ciclo(
           p_ancla,
           (date_trunc('month', ciclo_desde(p_ancla, p_zona))
             + interval '1 month')::date)
$fn$;

comment on function ciclo_desde(date, text) is
  'Cuándo empezó el ciclo de cupo vigente hoy para esa cuenta.';
comment on function ciclo_hasta(date, text) is
  'Cuándo se renueva el cupo. Fin exclusivo, siempre.';

-- ---------------------------------------------------------------------
-- 3. La vista de plataforma muestra el ciclo del cliente
-- ---------------------------------------------------------------------
-- La columna de IA de la tabla sigue siendo por mes calendario: sirve para
-- mirar el costo contra la factura del proveedor. Pero cuando alguien llama
-- diciendo "se me cortó el asistente", lo que hay que ver es SU ciclo, y ese
-- número tiene que ser idéntico al que él tiene en pantalla. Va en el panel
-- de Plan, que es donde se atiende ese reclamo.
--
-- Las columnas nuevas van al final y las que estaban no se tocan ni se
-- reordenan.
--
-- Los nombres de salida son `ciclo_inicio` y `ciclo_fin`, y no `ciclo_desde`
-- y `ciclo_hasta`: esos dos ya son funciones, y usar sus nombres como
-- columnas de salida las tapa adentro del cuerpo.
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
  ia_ciclo      int
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
         -- Por mes calendario: es la mirada de costo.
         coalesce((select count(distinct r.conversation_id)::int from ai_runs r
                    where r.tenant_id = t.id
                      and r.conversation_id is not null
                      and (p_mes is null
                           or (r.created_at >= mes_desde(p_mes, t.timezone)
                               and r.created_at < mes_hasta(p_mes, t.timezone)))), 0),
         t.plan_desde,
         ciclo_desde(t.plan_desde, t.timezone),
         ciclo_hasta(t.plan_desde, t.timezone),
         -- Por CICLO del cliente: el mismo número que ve él en su medidor.
         -- No depende de `p_mes`, porque el ciclo vigente es uno solo: el de
         -- hoy. Elegir agosto en el desplegable no cambia este número.
         coalesce((select count(distinct r.conversation_id)::int from ai_runs r
                    where r.tenant_id = t.id
                      and r.conversation_id is not null
                      and r.created_at >= mes_desde(
                            ciclo_desde(t.plan_desde, t.timezone), t.timezone)
                      and r.created_at < mes_desde(
                            ciclo_hasta(t.plan_desde, t.timezone), t.timezone)), 0)
    from tenants t
    left join verticals v on v.code = t.vertical
   order by t.created_at desc
$fn$;

revoke all on function superadmin_resumen(date) from public;
grant execute on function superadmin_resumen(date) to crm_app;

comment on function superadmin_resumen(date) is
  'Resumen de plataforma. costo_ia e ia_usadas son del mes calendario p_mes '
  '(null = historico), para mirar contra la factura del proveedor. ia_ciclo '
  'es del ciclo vigente del cliente y es el numero que el ve en su medidor.';

-- ---------------------------------------------------------------------
-- 4. Poder corregir desde cuándo corre el plan
-- ---------------------------------------------------------------------
-- Hace falta de verdad: una cuenta que empezó en prueba y pasó a pago dos
-- meses después tiene el `plan_desde` relleno con la fecha de creación, que
-- no es cuando empezó a pagar. Sin esta pantalla habría que entrar por SSH,
-- que es justo lo que la 0035 vino a sacar.
drop function if exists superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric);

create function superadmin_cambiar_plan(
  p_token_hash text,
  p_tenant_id  uuid,
  p_plan       text,
  p_max_users  int,
  p_max_wa     int,
  p_conv_cap   int,
  p_cost_cap   numeric,
  p_plan_desde date
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
  if p_conv_cap is not null and (p_conv_cap < 0 or p_conv_cap > 1000000) then
    return false;
  end if;
  if p_cost_cap is not null and (p_cost_cap < 0 or p_cost_cap > 100000) then
    return false;
  end if;
  -- La fecha del ciclo NO puede quedar en null: es lo que decide cuándo se
  -- renueva el cupo, y sin ella no hay ciclo. Tampoco puede estar en el
  -- futuro, que dejaría a la cuenta sin ciclo vigente y por lo tanto sin
  -- cupo, que es exactamente lo contrario de lo que quiso hacer quien la
  -- cargó.
  if p_plan_desde is null
     or p_plan_desde < date '2024-01-01'
     or p_plan_desde > (now() at time zone 'UTC')::date then
    return false;
  end if;

  select name,
         jsonb_build_object(
           'plan', plan, 'max_users', max_users,
           'max_wa_accounts', max_wa_accounts,
           'ai_monthly_conversation_cap', ai_monthly_conversation_cap,
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
         ai_monthly_conversation_cap = p_conv_cap,
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
              'ai_monthly_conversation_cap', p_conv_cap,
              'ai_monthly_cost_cap', p_cost_cap,
              'plan_desde', p_plan_desde)));
  return true;
end;
$fn$;

revoke all on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric, date) from public;
grant execute on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric, date) to crm_app;

comment on function superadmin_cambiar_plan(text, uuid, text, int, int, int, numeric, date) is
  'Cambia el plan, sus cuatro limites y desde cuando corre. Unica puerta: '
  'crm_app no tiene update sobre esas columnas y no lo tiene que tener.';
