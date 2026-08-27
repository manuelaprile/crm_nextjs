-- ---------------------------------------------------------------------
-- Interruptores por cuenta.
--
-- Todos los clientes comparten un contenedor y una base: una actualización
-- llega a todos en el mismo instante y no hay forma de que no. Lo que sí se
-- puede es que el código nuevo llegue APAGADO, se prenda en una sola cuenta,
-- se mire unos días, y recién después se prenda en el resto.
--
-- Eso es lo que hace esta tabla, y es lo más parecido a un despliegue gradual
-- que permite esta arquitectura. Su límite hay que tenerlo claro: solo cubre
-- lo que alguien se acordó de poner detrás de un interruptor. Un refactor que
-- rompe la bandeja no lo salva ningún interruptor; para eso está poder volver
-- atrás en un minuto (ver `./crm.sh volver`).
--
-- EL CATÁLOGO NO VIVE ACÁ, vive en el código (`lib/funciones.ts`).
--
-- Es a propósito. Un interruptor solo significa algo si hay una línea de
-- código que lo lee: si el catálogo estuviera en la base, se podrían crear
-- interruptores que no apagan nada y borrar los que sí, y la pantalla del
-- superadmin mostraría cosas que no hacen nada. Con el catálogo en el código,
-- la lista siempre es exactamente la de lo que de verdad se puede apagar.
-- Acá solo se guarda la EXCEPCIÓN: qué cuenta se apartó del valor por
-- defecto. Sin fila = vale lo que dice el código.
-- ---------------------------------------------------------------------

create table tenant_features (
  tenant_id       uuid not null references tenants(id) on delete cascade,
  codigo          text not null,
  activo          boolean not null,
  actualizado_por uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, codigo)
);
create trigger tenant_features_touch before update on tenant_features
  for each row execute function touch_updated_at();

comment on table tenant_features is
  'Excepciones al valor por defecto de cada función. Sin fila para una '
  'cuenta, vale lo que dice el catálogo en lib/funciones.ts.';

-- ---------------------------------------------------------------------
-- Permisos: se LEE desde la app, se ESCRIBE solo por superadmin.
--
-- Que un administrador de un consultorio pueda prenderse una función a sí
-- mismo vaciaría de sentido todo esto: lo que se está conteniendo es
-- justamente el alcance de algo nuevo. Por eso crm_app solo tiene select, y
-- la escritura pasa por las funciones de abajo, que verifican el token de
-- sesión y dejan constancia.
-- ---------------------------------------------------------------------
alter table tenant_features enable row level security;

create policy tenant_features_read on tenant_features
  for select to crm_app
  using (tenant_id = app_tenant_id());

-- El REVOKE es lo que importa de este bloque, no el grant.
--
-- La 0002 dejó puesto un `alter default privileges` que le da select, insert,
-- update y delete sobre CUALQUIER tabla nueva a crm_app y a crm_worker. O sea
-- que esta tabla nació con permiso de escritura para el panel sin que nadie
-- lo pidiera, y lo único que lo frenaba eran las políticas de RLS.
--
-- RLS alcanza —sin política de update, la sentencia toca cero filas— pero deja
-- una sola cerradura para algo que no se puede equivocar: el día que alguien
-- agregue una política más amplia para poder leer algo, la escritura se abre
-- de arriba. Sacando el permiso, el panel no puede escribir acá ni aunque las
-- políticas se lo permitan.
--
-- Las funciones de abajo no se ven afectadas: son `security definer` y corren
-- como el dueño de la tabla.
grant select on tenant_features to crm_app;
revoke insert, update, delete on tenant_features from crm_app;

-- El worker lee sin contexto de tenant: la ingesta y el agente resuelven la
-- cuenta a partir de una fila, no de una sesión. Tampoco escribe.
grant select on tenant_features to crm_worker;
revoke insert, update, delete on tenant_features from crm_worker;

-- ---------------------------------------------------------------------
-- Prender o apagar una función en UNA cuenta.
--
-- El código va como texto y no contra una lista en la base —el catálogo está
-- en el código— así que se valida el formato para que no entre cualquier
-- cosa: un código con un espacio o en mayúsculas nunca coincidiría con el
-- que lee el código, y el interruptor quedaría puesto sin apagar nada.
-- ---------------------------------------------------------------------
create or replace function superadmin_funcion_cuenta(
  p_token_hash text,
  p_tenant_id  uuid,
  p_codigo     text,
  p_activo     boolean
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_user   uuid;
  v_super  boolean;
  v_nombre text;
begin
  select s.user_id, u.is_superadmin
    into v_user, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return false;
  end if;

  if p_codigo !~ '^[a-z][a-z0-9-]{1,39}$' then
    return false;
  end if;

  select name into v_nombre from tenants where id = p_tenant_id;
  if v_nombre is null then
    return false;
  end if;

  insert into tenant_features (tenant_id, codigo, activo, actualizado_por)
  values (p_tenant_id, p_codigo, p_activo, v_user)
  on conflict (tenant_id, codigo)
  do update set activo = excluded.activo,
                actualizado_por = excluded.actualizado_por;

  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (p_tenant_id, v_user, 'user', 'superadmin.funcion',
          'tenant_features', p_codigo,
          jsonb_build_object('cuenta', v_nombre, 'activo', p_activo));
  return true;
end;
$fn$;

revoke all on function superadmin_funcion_cuenta(text, uuid, text, boolean) from public;
grant execute on function superadmin_funcion_cuenta(text, uuid, text, boolean) to crm_app;

-- ---------------------------------------------------------------------
-- Prender o apagar una función en TODAS las cuentas.
--
-- Escribe una fila explícita para cada cuenta, incluidas las que ya tenían
-- una decisión propia: es el botón de "esto ya está probado, va para todos",
-- y si respetara las excepciones anteriores no cumpliría lo que promete.
-- Deja una entrada de auditoría por cuenta, igual que el camino de a una:
-- dentro de un mes, la pregunta va a ser "¿por qué esta cuenta tiene esto?",
-- y la respuesta tiene que estar en el registro de ESA cuenta.
-- ---------------------------------------------------------------------
create or replace function superadmin_funcion_todas(
  p_token_hash text,
  p_codigo     text,
  p_activo     boolean
)
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_user  uuid;
  v_super boolean;
  v_n     int;
begin
  select s.user_id, u.is_superadmin
    into v_user, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return -1;
  end if;

  if p_codigo !~ '^[a-z][a-z0-9-]{1,39}$' then
    return -1;
  end if;

  insert into tenant_features (tenant_id, codigo, activo, actualizado_por)
  select t.id, p_codigo, p_activo, v_user from tenants t
  on conflict (tenant_id, codigo)
  do update set activo = excluded.activo,
                actualizado_por = excluded.actualizado_por;
  get diagnostics v_n = row_count;

  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  select t.id, v_user, 'user', 'superadmin.funcion',
         'tenant_features', p_codigo,
         jsonb_build_object('cuenta', t.name, 'activo', p_activo,
                            'masivo', true)
    from tenants t;

  return v_n;
end;
$fn$;

revoke all on function superadmin_funcion_todas(text, text, boolean) from public;
grant execute on function superadmin_funcion_todas(text, text, boolean) to crm_app;

-- ---------------------------------------------------------------------
-- Volver al valor por defecto: borrar la excepción.
--
-- Existe porque sin esto no hay vuelta: una vez que una cuenta tiene fila,
-- queda clavada aunque después cambie el valor por defecto del catálogo. Con
-- esto, "por defecto" vuelve a ser un estado alcanzable y no solo el punto
-- de partida.
-- ---------------------------------------------------------------------
create or replace function superadmin_funcion_defecto(
  p_token_hash text,
  p_tenant_id  uuid,
  p_codigo     text
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_user   uuid;
  v_super  boolean;
  v_nombre text;
begin
  select s.user_id, u.is_superadmin
    into v_user, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_user is null or not coalesce(v_super, false) then
    return false;
  end if;

  select name into v_nombre from tenants where id = p_tenant_id;
  if v_nombre is null then
    return false;
  end if;

  delete from tenant_features
   where tenant_id = p_tenant_id and codigo = p_codigo;

  insert into audit_log (tenant_id, actor_user_id, actor_kind, action,
                         entity, entity_id, diff)
  values (p_tenant_id, v_user, 'user', 'superadmin.funcion',
          'tenant_features', p_codigo,
          jsonb_build_object('cuenta', v_nombre, 'defecto', true));
  return true;
end;
$fn$;

revoke all on function superadmin_funcion_defecto(text, uuid, text) from public;
grant execute on function superadmin_funcion_defecto(text, uuid, text) to crm_app;
