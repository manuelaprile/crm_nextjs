-- Prueba de aislamiento. Se corre como crm_owner para armar los datos, y
-- después se cambia a crm_app (que NO tiene bypassrls) para verificar.
\set ON_ERROR_STOP on



-- Dos consultorios distintos.
insert into tenants (id, slug, name, vertical, status) values
  ('11111111-1111-1111-1111-111111111111','echeverria','Dr. Echeverría','medico','active'),
  ('22222222-2222-2222-2222-222222222222','otro','Otro consultorio','medico','active');

select seed_vertical_medico('11111111-1111-1111-1111-111111111111');
select seed_vertical_medico('22222222-2222-2222-2222-222222222222');

-- Un paciente en cada uno.
insert into contacts (tenant_id, display_name, city, stage_id)
select '11111111-1111-1111-1111-111111111111','Paciente de Echeverría','Córdoba', id
from stages where tenant_id='11111111-1111-1111-1111-111111111111' and key='consulta';

insert into contacts (tenant_id, display_name, city, stage_id)
select '22222222-2222-2222-2222-222222222222','Paciente del otro','Rosario', id
from stages where tenant_id='22222222-2222-2222-2222-222222222222' and key='consulta';

\echo ''
\echo '== Como crm_owner (dueño): ve los dos, como corresponde =='
select count(*) as contactos_totales from contacts;

-- A partir de acá, el rol de la app.
set role crm_app;

\echo ''
\echo '== Como crm_app SIN tenant seteado: no debe ver NADA (fail-closed) =='
select count(*) as sin_contexto from contacts;

\echo ''
\echo '== Como crm_app con tenant = Echeverría: solo el suyo =='
set app.tenant_id = '11111111-1111-1111-1111-111111111111';
set app.user_role = 'owner';
select count(*) as contactos, min(display_name) as ejemplo from contacts;
select count(*) as etapas from stages;

\echo ''
\echo '== Intento de fuga: pedir explícitamente el contacto del OTRO tenant =='
select count(*) as fuga from contacts
where tenant_id = '22222222-2222-2222-2222-222222222222';

\echo ''
\echo '== Intento de escritura cruzada: insertar en el tenant ajeno (debe fallar) =='
savepoint s1;
insert into contacts (tenant_id, display_name)
values ('22222222-2222-2222-2222-222222222222','Inyectado');
rollback to savepoint s1;

\echo ''
\echo '== Rol agent (la secretaria): lee la cuenta de WhatsApp pero no la escribe =='
set app.user_role = 'agent';
insert into channel_accounts (tenant_id, label)
values ('11111111-1111-1111-1111-111111111111','Principal');
