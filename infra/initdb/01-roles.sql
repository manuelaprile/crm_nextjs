-- Se ejecuta UNA sola vez, cuando el volumen de Postgres está vacío.
-- Crea los roles con contraseña; las migraciones después les dan permisos.
-- Las contraseñas se inyectan por variable de entorno desde docker-compose.
\set app_pass `echo "$APP_DB_PASSWORD"`
\set worker_pass `echo "$WORKER_DB_PASSWORD"`

create role crm_app    login noinherit password :'app_pass';
create role crm_worker login noinherit bypassrls password :'worker_pass';
