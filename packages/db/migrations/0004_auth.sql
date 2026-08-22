-- =====================================================================
-- SESIONES Y CONTROL DE FUERZA BRUTA
-- ---------------------------------------------------------------------
-- Modelo de sesión clásico (el mismo de PHP): la cookie lleva un id random,
-- el estado vive en la base. Ventaja sobre un JWT: se puede revocar. Si a un
-- empleado se le va el celular, se borra la fila y la sesión muere ya.
-- =====================================================================

create table sessions (
  -- Guardamos el HASH del token, no el token. Si alguien lee la tabla no
  -- puede hacerse pasar por nadie: es el mismo criterio que con las
  -- contraseñas.
  token_hash   text primary key,
  user_id      uuid not null references users(id) on delete cascade,
  -- El consultorio activo. Un usuario puede pertenecer a varios.
  tenant_id    uuid references tenants(id) on delete cascade,
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index on sessions (user_id);
create index on sessions (expires_at);

-- Intentos de login, para frenar la fuerza bruta. Se cuenta por email Y por IP:
-- por email solo, un atacante rota emails; por IP sola, un atacante rota IPs.
create table login_attempts (
  id         bigserial primary key,
  email      citext,
  ip         inet,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index on login_attempts (email, created_at desc);
create index on login_attempts (ip, created_at desc);

-- ¿Está bloqueado este intento? 5 fallos en 15 minutos por email o por IP.
create or replace function login_is_blocked(p_email citext, p_ip inet)
returns boolean
language sql stable as $fn$
  select exists (
    select 1 from login_attempts
    where not success
      and created_at > now() - interval '15 minutes'
      and (email = p_email or ip = p_ip)
    group by coalesce(email::text, ''), coalesce(ip::text, '')
    having count(*) >= 5
  )
$fn$;

-- Limpieza. La corre el cron diario junto con el backup.
create or replace function purge_expired_sessions()
returns void
language sql as $fn$
  delete from sessions where expires_at < now();
  delete from login_attempts where created_at < now() - interval '30 days';
$fn$;

-- ---------------------------------------------------------------------
-- Permisos: estas tablas NO llevan tenant_id y las maneja solo el flujo de
-- login. La app puede escribirlas, pero nunca las expone por una ruta.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on sessions to crm_app;
grant select, insert on login_attempts to crm_app;
grant usage, select on sequence login_attempts_id_seq to crm_app;
grant execute on function login_is_blocked(citext, inet) to crm_app;
grant execute on function purge_expired_sessions() to crm_app;

-- El worker no tiene nada que hacer con las sesiones de usuario.
revoke all on sessions from crm_worker;
revoke all on login_attempts from crm_worker;

-- ---------------------------------------------------------------------
-- Alta de usuario con hash de contraseña. La app NUNCA ve el hash: le pasa
-- la contraseña en claro a esta función y el hash se calcula del lado de
-- Postgres. bcrypt con coste 12.
-- ---------------------------------------------------------------------
create or replace function set_user_password(p_user_id uuid, p_password text)
returns void
language sql security definer set search_path = public, extensions as $fn$
  update users set password_hash = crypt(p_password, gen_salt('bf', 12))
  where id = p_user_id
$fn$;

revoke all on function set_user_password(uuid, text) from public;
grant execute on function set_user_password(uuid, text) to crm_app;
