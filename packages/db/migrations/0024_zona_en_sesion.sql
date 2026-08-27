-- ---------------------------------------------------------------------
-- La zona horaria de la cuenta, en la sesión.
--
-- Todas las fechas del panel se estaban dibujando con `toLocaleString` sin
-- decirle en qué zona. Sin ese dato, JavaScript usa la del proceso, y el
-- proceso corre en un contenedor: UTC. O sea que en producción TODO el panel
-- mostraba las horas tres horas adelantadas.
--
-- Se descubrió por una etiqueta de la bandeja —un turno de las 10:00 que
-- decía "mañana a la 01:00 pm"— pero pasaba en todos lados: la hora del
-- último mensaje, el "conectado desde", las fechas de las fichas.
--
-- `tenants.timezone` ya existía desde la 0001 y no lo usaba nadie. Ponerlo en
-- la sesión hace que esté disponible en cada pantalla sin una consulta
-- aparte: se resuelve una vez, con el resto de la sesión.
--
-- Es multi-cuenta: no alcanza con fijarle la zona al contenedor, porque dos
-- clientes pueden estar en husos distintos y ven el mismo servidor.
-- ---------------------------------------------------------------------

drop function if exists resolve_session(text);

create function resolve_session(p_token_hash text)
returns table (
  user_id          uuid,
  email            citext,
  name             text,
  is_superadmin    boolean,
  tenant_id        uuid,
  role             tenant_role,
  tenant_name      text,
  tenant_vertical  text,
  tenant_singular  text,
  tenant_plural    text,
  tenant_articulo  text,
  tenant_timezone  text,
  last_used_at     timestamptz
)
language sql security definer set search_path = public as $fn$
  select u.id, u.email, u.name, u.is_superadmin,
         s.tenant_id,
         case
           when tu.role is not null then tu.role
           when u.is_superadmin and s.tenant_id is not null then 'owner'::tenant_role
           else null
         end,
         t.name, t.vertical, v.singular, v.plural, v.articulo,
         t.timezone, s.last_used_at
    from sessions s
    join users u on u.id = s.user_id
    left join tenant_users tu
      on tu.user_id = s.user_id and tu.tenant_id = s.tenant_id
    left join tenants t on t.id = s.tenant_id
    left join verticals v on v.code = t.vertical
   where s.token_hash = p_token_hash
     and s.expires_at > now()
     and u.disabled_at is null
     and (t.id is null or t.status in ('trial','active'))
$fn$;

revoke all on function resolve_session(text) from public;
grant execute on function resolve_session(text) to crm_app;
