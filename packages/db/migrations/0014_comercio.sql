-- =====================================================================
-- DATOS DEL COMERCIO
-- ---------------------------------------------------------------------
-- Dirección, teléfonos, CUIT, horarios y logo del cliente. Hoy esos datos
-- viven en tres lugares distintos y ninguno bueno: en la cabeza del cliente,
-- pegados a mano dentro del prompt del asistente, y repetidos en cada
-- respuesta de WhatsApp.
--
-- Al ponerlos en una tabla, el asistente puede leerlos en vez de tenerlos
-- transcriptos, y dejan de quedar desactualizados cuando el cliente se muda.
--
-- Va en tabla aparte y no en columnas de `tenants` porque `tenants` es del
-- superadmin (plan, límites, estado) y esto es del cliente. La política de
-- escritura es distinta, así que la tabla también.
-- =====================================================================

create table tenant_profiles (
  tenant_id    uuid primary key references tenants(id) on delete cascade,
  legal_name   text,                    -- razón social
  tax_id       text,                    -- CUIT
  phone        text,
  whatsapp     text,
  email        text,
  address      text,
  city         text,
  province     text,
  postal_code  text,
  hours        text,                    -- horarios de atención, texto libre
  -- El logo va en la base y no en disco: el contenedor se recrea en cada
  -- despliegue y un volumen más es una cosa más que puede faltar en el
  -- backup. Son unos pocos KB. El tope está en el check, no solo en la app.
  logo_mime    text,
  logo_bytes   bytea,
  logo_updated_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint logo_no_gigante check (
    logo_bytes is null or octet_length(logo_bytes) <= 524288
  ),
  constraint logo_tipo_conocido check (
    logo_mime is null or logo_mime in
      ('image/png','image/jpeg','image/webp','image/svg+xml')
  )
);

create trigger tenant_profiles_touch before update on tenant_profiles
  for each row execute function touch_updated_at();

alter table tenant_profiles enable row level security;
alter table tenant_profiles force row level security;

-- Todo el equipo los lee (la secretaria necesita la dirección para
-- contestar); los edita solo el dueño o un administrador.
create policy tenant_profiles_read on tenant_profiles
  for select to crm_app
  using (tenant_id = app_tenant_id());

create policy tenant_profiles_write on tenant_profiles
  for all to crm_app
  using (tenant_id = app_tenant_id() and app_is_admin())
  with check (tenant_id = app_tenant_id() and app_is_admin());

grant select, insert, update, delete on tenant_profiles to crm_app;
grant select on tenant_profiles to crm_worker;

-- El agente también los necesita: contesta "¿dónde quedan?" sin que nadie
-- haya copiado la dirección adentro del prompt.
create policy tenant_profiles_worker on tenant_profiles
  for select to crm_worker using (true);

-- Arranca con una fila por cuenta, así el formulario no tiene que distinguir
-- entre "no hay fila" y "está vacía".
insert into tenant_profiles (tenant_id)
  select id from tenants on conflict do nothing;

-- ---------------------------------------------------------------------
-- De paso: la política `tenants_update` decía en su comentario que el panel
-- nunca toca los límites del plan, pero no lo impedía. Un admin podía subir
-- su propio `max_users` o su tope de gasto de IA mandando el campo a mano.
-- Nunca hubo una pantalla que lo expusiera, pero eso es suerte, no una
-- defensa.
--
-- Los permisos por COLUMNA sí lo impiden: el panel solo puede escribir el
-- nombre y la configuración regional. El plan y los límites siguen siendo
-- del superadmin, que va por crm_owner y no pasa por acá.
-- ---------------------------------------------------------------------
revoke update on tenants from crm_app;
grant update (name, timezone, locale) on tenants to crm_app;
