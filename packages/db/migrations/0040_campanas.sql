-- =====================================================================
-- BORRADORES DE CAMPAÑA
-- ---------------------------------------------------------------------
-- El compositor de Campañas ya se podía usar pero no se podía guardar: se
-- cerraba la pestaña y se perdía lo escrito. Esto es la tabla donde vive.
--
-- SE GUARDAN LOS FILTROS, NO LA LISTA DE DESTINATARIOS
-- ---------------------------------------------------------------------
-- Una campaña "a todos los que están en Interesado" que se guarda el lunes y
-- se manda el jueves tiene que salirle a los de EL JUEVES. Si se congelara la
-- lista al guardar, el que entró el martes queda afuera sin que nadie lo
-- decida, y el que se archivó el miércoles la recibe igual.
--
-- La excepción es la selección A MANO: ahí la lista ES la decisión, así que
-- esa sí se guarda tal cual, en `contactos_elegidos`. Son dos cosas distintas
-- y por eso `destino` dice cuál mandó.
--
-- LA IMAGEN VA EN POSTGRES, NO EN UN VOLUMEN
-- ---------------------------------------------------------------------
-- Misma regla que la 0019 y que los archivos de Info del negocio: lo que está
-- en la base entra en el `pg_dump` y vuelve con la copia de seguridad. Un
-- archivo en disco se pierde al recrear el contenedor y nadie se entera hasta
-- que hace falta.
--
-- OJO CON LO QUE ESTA TABLA NO ES
-- ---------------------------------------------------------------------
-- No es una cola de envío. No hay estado "enviando", ni destinatario por
-- destinatario, ni reintentos, porque todavía no se puede enviar: fuera de la
-- ventana de 24 h WhatsApp exige una plantilla aprobada por Meta y eso no
-- existe en el sistema. Cuando exista, el envío es otra tabla —una fila por
-- destinatario, con su estado— y esta se queda siendo lo que es: lo que
-- alguien redactó.
-- =====================================================================

create table if not exists campanas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  nombre      text not null,
  -- 'borrador' es el único estado por ahora. La columna existe igual para
  -- que agregar 'enviada' no sea una migración con la tabla ya en uso.
  estado      text not null default 'borrador',
  -- 'todos' | 'filtros' | 'manual'. Sin enum: agregar un valor a un enum en
  -- Postgres es más caro que agregarlo acá, y esto lo valida el código.
  destino     text not null default 'todos',
  -- { etapas: [uuid], etiquetas: [uuid] }. Solo se mira si destino='filtros'.
  filtros     jsonb not null default '{}'::jsonb,
  mensaje     text not null default '',
  imagen_mime text,
  imagen      bytea,
  creada_por  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists campanas_de_la_cuenta
  on campanas (tenant_id, updated_at desc);

create trigger campanas_touch before update on campanas
  for each row execute function touch_updated_at();

alter table campanas enable row level security;

create policy campanas_rw on campanas
  for all to crm_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

grant select, insert, update, delete on campanas to crm_app;
-- El worker NO escribe acá. Hoy no manda campañas nadie automáticamente, y
-- dar permisos "por si acaso" es cómo se termina con un proceso de fondo
-- tocando algo que nadie esperaba. Se le da el día que haya envío.

comment on table campanas is
  'Lo que alguien redactó para mandar a varios contactos. Guarda los FILTROS, '
  'no la lista resuelta: una campaña guardada el lunes y enviada el jueves '
  'tiene que salirle a los del jueves.';

-- ---------------------------------------------------------------------
-- Los elegidos a mano
-- ---------------------------------------------------------------------
-- Tabla aparte y no un array de uuid adentro de `filtros`: así la llave
-- foránea hace su trabajo. Un contacto borrado desaparece solo de las
-- campañas que lo tenían, en vez de quedar como un id colgado que el día del
-- envío no resuelve a nadie.
--
-- La llave foránea es COMPUESTA, contra `contacts (id, tenant_id)`: es la
-- misma lección de la 0031: sin el tenant en la llave, nada impide guardar el
-- contacto de otro cliente como destinatario de esta campaña.
create table if not exists campana_contactos (
  campana_id uuid not null,
  contact_id uuid not null,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  primary key (campana_id, contact_id),
  foreign key (campana_id) references campanas (id) on delete cascade,
  foreign key (contact_id, tenant_id) references contacts (id, tenant_id)
    on delete cascade
);

create index if not exists campana_contactos_por_campana
  on campana_contactos (campana_id);

alter table campana_contactos enable row level security;

create policy campana_contactos_rw on campana_contactos
  for all to crm_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

grant select, insert, update, delete on campana_contactos to crm_app;

comment on table campana_contactos is
  'Los contactos elegidos a mano para una campaña. Solo se miran cuando '
  'campanas.destino = ''manual''; con filtros la lista se resuelve al enviar.';
