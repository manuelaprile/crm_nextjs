-- =====================================================================
-- RUBROS (VERTICALES) COMO CATÁLOGO, NO COMO ENUM
-- ---------------------------------------------------------------------
-- Hasta acá el vertical era un enum de cuatro valores fijos y toda la
-- interfaz decía "consultorio". Eso alcanzaba para un solo cliente médico,
-- pero el producto es el mismo para una inmobiliaria, un estudio contable o
-- un gimnasio: cambia el RÓTULO, no el sistema.
--
-- Dos problemas con el enum:
--   1. Agregar un valor a un enum no se puede hacer dentro de una
--      transacción, y las migraciones corren en transacción (ver
--      scripts/migrate.ts). O sea: cada rubro nuevo era una migración a mano.
--   2. Un enum no tiene dónde guardar el rótulo ("Consultorio"), el plural
--      ("Consultorios") ni el género ("el" / "la"), que es justamente lo que
--      necesita la interfaz para no hablar en médico.
--
-- Se pasa a tabla-catálogo. Misma idea que las etapas del embudo: el dato
-- que cambia por cliente vive en una fila, no en el código.
-- =====================================================================

create table verticals (
  code       text primary key,
  singular   text not null,          -- "Consultorio"
  plural     text not null,          -- "Consultorios"
  -- Para que la interfaz pueda escribir "del consultorio" / "de la
  -- inmobiliaria" sin que quede en spanglish.
  articulo   text not null default 'el' check (articulo in ('el','la')),
  position   int  not null default 50,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table verticals is
  'Catálogo de rubros. El rótulo que ve el usuario sale de acá, no del código.';

insert into verticals (code, singular, plural, articulo, position) values
  ('medico',       'Consultorio',      'Consultorios',       'el', 10),
  ('inmobiliaria', 'Inmobiliaria',     'Inmobiliarias',      'la', 20),
  ('contable',     'Estudio contable', 'Estudios contables', 'el', 30),
  ('juridico',     'Estudio jurídico', 'Estudios jurídicos', 'el', 40),
  ('ecommerce',    'Tienda',           'Tiendas',            'la', 50),
  ('colegio',      'Colegio',          'Colegios',           'el', 60),
  ('generico',     'Negocio',          'Negocios',           'el', 99);

-- El catálogo se lee desde el panel; escribirlo es solo del superadmin y va
-- por función (más abajo). Por eso no se le da insert/update/delete a la app.
grant select on verticals to crm_app;
revoke insert, update, delete on verticals from crm_app;

-- ---------------------------------------------------------------------
-- tenants.vertical: de enum a texto con clave foránea al catálogo.
-- Los cuatro valores viejos ya están sembrados arriba, así que ninguna
-- cuenta existente queda huérfana.
-- ---------------------------------------------------------------------
alter table tenants alter column vertical drop default;
alter table tenants alter column vertical type text using vertical::text;
alter table tenants alter column vertical set default 'generico';
alter table tenants add constraint tenants_vertical_fkey
  foreign key (vertical) references verticals(code) on update cascade;

-- =====================================================================
-- Funciones que devolvían el enum. Cambia el tipo de retorno, así que hay
-- que borrarlas y volver a crearlas (create or replace no puede cambiar la
-- firma de salida). De paso, todas suman el rótulo del rubro: la interfaz
-- necesita saber si tiene que decir "consultorio" o "inmobiliaria".
-- =====================================================================

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
         t.name, t.vertical, v.singular, v.plural, v.articulo, s.last_used_at
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

drop function if exists user_tenants(uuid);

create function user_tenants(p_user_id uuid)
returns table (
  tenant_id uuid, name text, vertical text, singular text, role tenant_role
)
language sql security definer set search_path = public as $fn$
  select t.id, t.name, t.vertical, coalesce(v.singular, 'Cuenta'), tu.role
    from tenant_users tu
    join tenants t on t.id = tu.tenant_id
    left join verticals v on v.code = t.vertical
   where tu.user_id = p_user_id
     and t.status in ('trial','active')
   order by t.name
$fn$;

revoke all on function user_tenants(uuid) from public;
grant execute on function user_tenants(uuid) to crm_app;

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
  created_at    timestamptz
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
         t.created_at
    from tenants t
    left join verticals v on v.code = t.vertical
   order by t.created_at desc
$fn$;

revoke all on function superadmin_resumen() from public;
grant execute on function superadmin_resumen() to crm_app;

-- El enum ya no lo usa nadie.
drop function if exists superadmin_crear_consultorio(text, text, tenant_vertical, citext, text, text);
drop type if exists tenant_vertical;

-- =====================================================================
-- PLANTILLA PARA LOS RUBROS QUE NO SON EL MÉDICO
-- ---------------------------------------------------------------------
-- Una cuenta sin etapas es un tablero vacío: no se puede mover un contacto a
-- ningún lado. Así que todo rubro nuevo arranca con un embudo genérico de
-- cinco pasos, que el cliente después renombra desde el panel.
-- =====================================================================

create or replace function prompt_recepcion_generico(p_tenant_id uuid)
returns text
language plpgsql as $fn$
declare v_nombre text; v_rubro text;
begin
  select t.name, coalesce(v.singular, 'negocio')
    into v_nombre, v_rubro
    from tenants t left join verticals v on v.code = t.vertical
   where t.id = p_tenant_id;

  return format($p$Sos quien atiende el WhatsApp de %s (%s).

QUÉ HACÉS
- Respondés consultas de gente que escribe por primera vez.
- Tomás los datos básicos: nombre, de dónde escribe y qué necesita.
- Cuando la consulta avanza, la pasás a una persona del equipo.

CÓMO ESCRIBÍS
- En español rioplatense, de vos. Mensajes cortos, como un WhatsApp real.
- Una pregunta por mensaje. No mandes párrafos largos.
- No uses emojis salvo que la otra persona los use primero.

LO QUE NO HACÉS NUNCA
- No inventás precios, plazos, direcciones ni disponibilidad. Si no lo sabés,
  decís que lo consultás y derivás.
- No cerrás operaciones ni tomás compromisos en nombre del negocio.
- No pedís datos de tarjeta, claves ni documentación sensible.

CUÁNDO DERIVÁS A UNA PERSONA
- Si te piden un precio o una condición que no tenés confirmada.
- Si hay un reclamo, un enojo o algo que pinta a problema.
- Si te lo piden explícitamente.

FALTA COMPLETAR (lo carga el cliente desde Configuración - Asistente IA):
dirección, horarios de atención, qué vende o qué servicio presta, formas de
pago y cualquier dato que se repita en las consultas.$p$, v_nombre, lower(v_rubro));
end
$fn$;

create or replace function seed_vertical_generico(p_tenant_id uuid)
returns void
language plpgsql as $fn$
begin
  insert into stages (tenant_id, key, name, color, position, is_initial, is_won, is_lost)
  values
    (p_tenant_id, 'nuevo',      'Consulta nueva', '#94A3B8', 0, true,  false, false),
    (p_tenant_id, 'contactado', 'Contactado',     '#3B82F6', 1, false, false, false),
    (p_tenant_id, 'interesado', 'Interesado',     '#8B5CF6', 2, false, false, false),
    (p_tenant_id, 'cerrado',    'Cerrado',        '#10B981', 3, false, true,  false),
    (p_tenant_id, 'descartado', 'Descartado',     '#EF4444', 4, false, false, true)
  on conflict (tenant_id, key) do nothing;

  insert into tags (tenant_id, name, color) values
    (p_tenant_id, 'Urgente',           '#EF4444'),
    (p_tenant_id, 'Vino por Instagram','#EC4899'),
    (p_tenant_id, 'Recomendado',       '#8B5CF6'),
    (p_tenant_id, 'Fuera de zona',     '#6B7280'),
    (p_tenant_id, 'Volver a llamar',   '#F97316')
  on conflict (tenant_id, name) do nothing;

  insert into custom_field_defs (tenant_id, key, label, type, options, position)
  values
    (p_tenant_id, 'motivo', 'Motivo de la consulta', 'text', '[]'::jsonb, 0),
    (p_tenant_id, 'como_nos_conocio', 'Cómo nos conoció', 'select',
      '["Instagram","Facebook","Google","Recomendación","Cartel","Otro"]'::jsonb, 1),
    (p_tenant_id, 'presupuesto', 'Presupuesto estimado', 'text', '[]'::jsonb, 2)
  on conflict (tenant_id, key) do nothing;

  -- Igual que en el médico: arranca APAGADO. Se prende cuando el cliente
  -- leyó y aprobó las instrucciones.
  insert into agent_configs (
    tenant_id, channel, enabled, assistant_name, provider, model,
    enabled_tools, max_turns, handoff_keywords, system_prompt
  ) values (
    p_tenant_id, 'whatsapp', false, 'Recepción', 'openai', 'gpt-4o-mini',
    array['set_stage','set_contact_info','add_note','handoff'],
    6,
    array['reclamo','abogado','denuncia','estafa','urgente','urgencia'],
    prompt_recepcion_generico(p_tenant_id)
  )
  on conflict (tenant_id, channel) do nothing;
end
$fn$;

-- Un solo punto de entrada: el que da de alta no tiene que saber qué
-- plantilla corresponde a cada rubro.
create or replace function seed_vertical(p_tenant_id uuid, p_vertical text)
returns void
language plpgsql as $fn$
begin
  if p_vertical = 'medico' then
    perform seed_vertical_medico(p_tenant_id);
  else
    perform seed_vertical_generico(p_tenant_id);
  end if;
end
$fn$;

-- =====================================================================
-- ALTA DE UNA CUENTA DESDE EL PANEL DE SUPERADMIN
-- ---------------------------------------------------------------------
-- Antes había que entrar por SSH y correr un script. Ahora se hace desde la
-- pantalla de Plataforma.
--
-- Recibe el hash del token de sesión y verifica el superadmin ACÁ ADENTRO,
-- igual que superadmin_entrar (0012). La versión anterior confiaba en que el
-- llamador ya había chequeado el permiso; ésta no confía en nadie.
-- =====================================================================

create or replace function superadmin_crear_rubro(
  p_token_hash text, p_code text, p_singular text, p_plural text, p_articulo text
) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_super boolean;
begin
  select u.is_superadmin into v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();
  if not coalesce(v_super, false) then return null; end if;

  if p_code !~ '^[a-z0-9_-]{2,40}$' then return null; end if;

  insert into verticals (code, singular, plural, articulo)
  values (p_code, p_singular, p_plural,
          case when p_articulo = 'la' then 'la' else 'el' end)
  on conflict (code) do update
     set singular = excluded.singular,
         plural   = excluded.plural,
         articulo = excluded.articulo,
         active   = true;

  return p_code;
end
$fn$;

revoke all on function superadmin_crear_rubro(text, text, text, text, text) from public;
grant execute on function superadmin_crear_rubro(text, text, text, text, text) to crm_app;

create or replace function superadmin_crear_cuenta(
  p_token_hash text, p_slug text, p_nombre text, p_vertical text,
  p_email citext, p_nombre_usuario text, p_clave text
) returns uuid
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_actor uuid; v_super boolean; v_tenant uuid; v_user uuid; v_existia boolean;
begin
  select s.user_id, u.is_superadmin into v_actor, v_super
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.expires_at > now();

  if v_actor is null or not coalesce(v_super, false) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;

  if not exists (select 1 from verticals where code = p_vertical and active) then
    raise exception 'rubro inexistente: %', p_vertical using errcode = '23503';
  end if;

  insert into tenants (slug, name, vertical, status)
  values (p_slug, p_nombre, p_vertical, 'trial')
  returning id into v_tenant;

  -- Etapas, etiquetas, campos e instrucciones del asistente.
  perform seed_vertical(v_tenant, p_vertical);

  select exists (select 1 from users where email = p_email) into v_existia;

  -- Si el email ya existe (alguien que atiende varias cuentas), NO se le pisa
  -- ni el nombre ni la contraseña: solo se lo suma como dueño de la nueva.
  insert into users (email, name) values (p_email, p_nombre_usuario)
  on conflict (email) do update set name = users.name
  returning id into v_user;

  if not v_existia then
    perform set_user_password(v_user, p_clave);
  end if;

  insert into tenant_users (tenant_id, user_id, role)
  values (v_tenant, v_user, 'owner')
  on conflict (tenant_id, user_id) do update set role = 'owner';

  insert into audit_log (tenant_id, actor_user_id, actor_kind, action, entity, entity_id, diff)
  values (v_tenant, v_actor, 'user', 'superadmin.creo_cuenta', 'tenant', v_tenant::text,
          jsonb_build_object('slug', p_slug, 'nombre', p_nombre, 'rubro', p_vertical));

  return v_tenant;
end
$fn$;

revoke all on function superadmin_crear_cuenta(text, text, text, text, citext, text, text) from public;
grant execute on function superadmin_crear_cuenta(text, text, text, text, citext, text, text) to crm_app;
