-- =====================================================================
-- EL CUPO DEL PLAN SE MIDE EN CONVERSACIONES, NO EN DÓLARES
-- ---------------------------------------------------------------------
-- Los planes publicados venden "500 / 1.500 conversaciones atendidas por IA
-- por mes". El único tope que existía era `ai_monthly_cost_cap`, en dólares
-- gastados: sirve como red de seguridad, pero no es la unidad con la que se
-- vende y no se le puede mostrar al cliente.
--
-- Se agrega el cupo en conversaciones. Los dos topes conviven a propósito:
--
--  - `ai_monthly_conversation_cap` es lo que se vende y lo que ve el cliente.
--  - `ai_monthly_cost_cap` es la red contra un caso patológico que el otro no
--    atrapa: un catálogo enorme releído en loop gasta muchísimo en UNA sola
--    conversación, y el contador de conversaciones ni se entera.
--
-- QUÉ CUENTA COMO UNA CONVERSACIÓN: `count(distinct conversation_id)` sobre
-- `ai_runs` dentro del mes calendario. Distintas, no respuestas: hoy una
-- conversación son unas 5 respuestas del modelo, así que contar respuestas
-- daría un número cinco veces más chico y otro producto. Es lo que dice la
-- copy publicada y es lo que va a entender el cliente.
--
-- Las lecturas de archivo quedan afuera solas, porque se registran con
-- `conversation_id` en null (ver `ai/lector.ts`). Suman al tope de gasto,
-- que es donde corresponde: cuestan plata pero no atienden a nadie.
--
-- Esto depende de la 0033: sin ella, borrar contactos vaciaba el contador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El cupo nuevo.
--
-- Arranca en 500 —el plan Start— y las cuentas que ya existen se quedan con
-- eso. Ponerlo en null (sin tope) para las que ya están sería regalarles
-- barra libre sin que nadie lo decida.
-- ---------------------------------------------------------------------
alter table tenants
  add column if not exists ai_monthly_conversation_cap int default 500;

update tenants set ai_monthly_conversation_cap = 500
 where ai_monthly_conversation_cap is null;

comment on column tenants.ai_monthly_conversation_cap is
  'Conversaciones distintas que puede atender la IA por mes calendario. '
  'NULL = sin tope (plan Business). Es el cupo que se vende y el que ve el '
  'cliente; ai_monthly_cost_cap es la red de seguridad en dólares.';

-- ---------------------------------------------------------------------
-- 2. "Sin tope" tiene que ser representable.
--
-- Business vende usuarios ilimitados y varios números. Con las columnas en
-- `not null` no había forma de decirlo: el 0 significa "cero permitido" y un
-- número gigante parece un límite real que nadie sabe si es a propósito.
--
-- OJO al leerlas desde el código: en JavaScript `5 >= null` es `true`, así
-- que comparar a mano BLOQUEA a la cuenta que no tiene límite. Todo pasa por
-- `dentroDelTope()` en `lib/planes.ts`.
-- ---------------------------------------------------------------------
alter table tenants alter column max_users           drop not null;
alter table tenants alter column max_wa_accounts     drop not null;
alter table tenants alter column ai_monthly_cost_cap drop not null;

comment on column tenants.max_users is
  'Usuarios del panel. NULL = sin tope.';
comment on column tenants.max_wa_accounts is
  'Números de WhatsApp conectados. NULL = sin tope.';

-- ---------------------------------------------------------------------
-- 3. Permisos.
--
-- El SELECT de `tenants` es a nivel tabla, así que una columna nueva ya
-- queda legible; se explicita igual para que no dependa de eso.
--
-- El UPDATE NO se toca, y es el punto: la 0014 le revocó a `crm_app` el
-- update sobre `tenants` y le devolvió solo (name, timezone, locale). Como
-- los permisos de escritura son POR COLUMNA, una columna nueva nace
-- inescribible desde el panel. Un admin no puede subirse su propio cupo ni
-- aunque encuentre el formulario: se cambia por función `security definer`,
-- igual que suspender una cuenta.
-- ---------------------------------------------------------------------
grant select (ai_monthly_conversation_cap) on tenants to crm_app, crm_worker;

-- ---------------------------------------------------------------------
-- 4. El índice que usa el contador.
--
-- La cuenta del mes filtra por cuenta y fecha y agrupa por conversación. Sin
-- esto recorre todas las corridas históricas de la cuenta en cada mensaje
-- que entra, que es el peor lugar donde ponerse lento.
-- ---------------------------------------------------------------------
create index if not exists ai_runs_cupo_mensual
  on ai_runs (tenant_id, created_at desc)
  where conversation_id is not null;
