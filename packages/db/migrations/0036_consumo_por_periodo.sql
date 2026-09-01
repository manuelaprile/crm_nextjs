-- =====================================================================
-- EL CONSUMO DE IA, MES POR MES Y ACUMULADO
-- ---------------------------------------------------------------------
-- `superadmin_resumen()` mostraba SIEMPRE el mes en curso y nada más. Sirve
-- para vigilar, no para entender: el día 2 la pantalla está casi vacía, no
-- hay forma de ver si una cuenta viene creciendo o de sumar lo que costó
-- desde que empezó, y el 1º a la madrugada se borra el mes que importaba.
--
-- Ahora la función recibe UN MES —el primer día, como `date`— y `null`
-- significa todo el histórico. El parámetro es obligatorio: una función que
-- cambia de significado según cuántos argumentos le pasás es una trampa.
--
-- Va un mes y no un rango libre a propósito. El rango libre parece más
-- flexible y trae un problema: las fronteras las calcularía JavaScript, en la
-- zona horaria del proceso, mientras el cupo del cliente las calcula la base
-- con `date_trunc('month', now())`. Dos pantallas cortando el mes con tres
-- horas de diferencia es un bug que aparece una vez por mes, a la noche, y
-- nadie entiende. Acá el corte lo hace la base en los dos lados.
--
--   `>= p_mes` y `< p_mes + 1 mes`. Fin EXCLUSIVO, nunca `<= 31/8`, que se
--   come lo que pasó el 31 a las 23:40.
--
-- Y el mes empieza en la ZONA HORARIA DE LA CUENTA, no en UTC. Comparar
-- `created_at >= '2026-08-01'` a secas corta a las 00:00 UTC, que en Argentina
-- son las 21:00 del 31: tres horas de consumo se le cargan al mes siguiente.
-- Se ve poco y hace ruido justo donde más molesta —el cupo de un cliente se
-- renovaría a las nueve de la noche del último día, y la pantalla del
-- superadmin no coincidiría con el medidor del cliente— así que el corte va
-- por `t.timezone`, que es lo que esa cuenta llama "el 1º".
--
-- Lo que NO se filtra por período: usuarios, contactos y conversaciones. Son
-- lo que la cuenta TIENE hoy, no lo que gastó en un rango; filtrarlos daría
-- "contactos creados en agosto", que es otra pregunta y nadie la hizo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El cupo de Start baja a 300 y el de Pro a 900
-- ---------------------------------------------------------------------
-- Decisión comercial del 01/09/2026. Acá se cambia SOLO el default, o sea
-- las cuentas que se creen de ahora en adelante, que nacen en Start.
--
-- A las cuentas que YA existen no se les toca el cupo. Bajarle el límite a
-- alguien que está pagando es una decisión por cliente y con aviso, no un
-- update masivo dentro de una migración: si esto le bajara el cupo a una
-- cuenta que hoy va por 400 conversaciones, la IA le deja de contestar en
-- medio del mes y se entera por un cliente enojado. Se ajusta una por una
-- desde Plataforma → la cuenta → Plan.
--
-- El tope de gasto también se alinea con Start (25), que es el que le
-- corresponde a una cuenta nueva. Los 20 de la 0001 eran de antes de que
-- existiera el catálogo.
alter table tenants alter column ai_monthly_conversation_cap set default 300;
alter table tenants alter column ai_monthly_cost_cap set default 25.00;

-- ---------------------------------------------------------------------
-- 2. Dónde empieza y dónde termina un mes, para una cuenta
-- ---------------------------------------------------------------------
-- Una sola definición, usada por la vista de plataforma Y por el cupo que ve
-- el cliente. Con la cuenta hecha en cada lado, los dos números se separan
-- tres horas dos veces por mes y el soporte se vuelve imposible: "acá me dice
-- 12 y al cliente 13" no se puede explicar.
--
-- `immutable` no: dependen del catálogo de zonas horarias. `stable` alcanza
-- para que el planificador las evalúe una vez por consulta.
create or replace function mes_desde(p_mes date, p_zona text)
returns timestamptz language sql stable as $fn$
  select p_mes::timestamp at time zone p_zona
$fn$;

create or replace function mes_hasta(p_mes date, p_zona text)
returns timestamptz language sql stable as $fn$
  select (p_mes + interval '1 month')::timestamp at time zone p_zona
$fn$;

/* El mes en curso PARA ESA CUENTA. `now()` pasado a la zona da la fecha
   local; truncarla da el 1º local; volver a la zona lo convierte en el
   instante real en que empezó el mes. Es lo que reemplaza al
   `date_trunc('month', now())` que cortaba en UTC. */
create or replace function mes_en_curso(p_zona text)
returns date language sql stable as $fn$
  select date_trunc('month', now() at time zone p_zona)::date
$fn$;

comment on function mes_desde(date, text) is
  'El instante en que empieza ese mes para una cuenta en esa zona horaria.';
comment on function mes_hasta(date, text) is
  'El instante en que empieza el mes SIGUIENTE. Fin exclusivo, siempre.';
comment on function mes_en_curso(text) is
  'Qué mes es hoy para una cuenta en esa zona horaria.';

-- ---------------------------------------------------------------------
-- 3. El resumen, con período
-- ---------------------------------------------------------------------
drop function if exists superadmin_resumen();
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
                      and (p_mes is null
                           or (r.created_at >= mes_desde(p_mes, t.timezone)
                               and r.created_at < mes_hasta(p_mes, t.timezone)))), 0),
         t.ai_monthly_cost_cap,
         t.created_at,
         t.max_users,
         t.max_wa_accounts,
         t.ai_monthly_conversation_cap,
         -- Conversaciones distintas del mes pedido. Con el mes en curso da
         -- lo mismo que `cupoDeIa` en el panel del cliente, que es lo que
         -- tiene que pasar: dos pantallas con números distintos hacen
         -- imposible el soporte.
         coalesce((select count(distinct r.conversation_id)::int from ai_runs r
                    where r.tenant_id = t.id
                      and r.conversation_id is not null
                      and (p_mes is null
                           or (r.created_at >= mes_desde(p_mes, t.timezone)
                               and r.created_at < mes_hasta(p_mes, t.timezone)))), 0)
    from tenants t
    left join verticals v on v.code = t.vertical
   order by t.created_at desc
$fn$;

revoke all on function superadmin_resumen(date) from public;
grant execute on function superadmin_resumen(date) to crm_app;

comment on function superadmin_resumen(date) is
  'Resumen de plataforma. El consumo de IA se acota al mes que empieza en '
  'p_mes; null es todo el histórico. Usuarios, contactos y conversaciones son '
  'siempre el total actual, no dependen del mes.';

-- ---------------------------------------------------------------------
-- 4. Qué meses ofrecer en el desplegable
-- ---------------------------------------------------------------------
-- Del primer mes con consumo hasta el actual, todos seguidos.
--
-- La otra opción era un `distinct` de los meses que tienen filas, que suena
-- más prolijo y tiene un agujero: un mes cuyo único consumo cae en las horas
-- que UTC y la zona del cliente no comparten se listaría bajo el mes de al
-- lado, y el mes de verdad desaparecería del desplegable. Un mes que existió
-- y no se puede elegir es peor que un mes vacío.
--
-- Tampoco son "los últimos doce" fijos: no inventa meses anteriores a que la
-- plataforma existiera. Y el mes en curso está siempre, aunque todavía no
-- haya ninguna corrida, porque es la opción por defecto de la pantalla y
-- tiene que estar el día 1º a las 00:05.
create or replace function superadmin_meses_de_consumo()
returns setof date
language sql security definer set search_path = public as $fn$
  select mes::date from generate_series(
           coalesce((select date_trunc('month', min(created_at)) from ai_runs),
                    date_trunc('month', now())),
           date_trunc('month', now()),
           interval '1 month') as mes
   order by mes desc
$fn$;

revoke all on function superadmin_meses_de_consumo() from public;
grant execute on function superadmin_meses_de_consumo() to crm_app;

comment on function superadmin_meses_de_consumo() is
  'Los meses desde el primero con consumo de IA hasta el actual, del más '
  'nuevo al más viejo. Para armar el desplegable de período en Plataforma.';
