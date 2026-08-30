-- =====================================================================
-- LA INFORMACIÓN DEL NEGOCIO PUEDE TRAER ARCHIVOS, Y PUEDE TENER DUEÑO
-- ---------------------------------------------------------------------
-- Dos cosas que se piden juntas porque se usan juntas, en la misma pantalla
-- y sobre la misma fila:
--
--  1. ARCHIVOS. Hoy cargar "Productos" significa tipear la lista entera en
--     un textarea. El negocio ya tiene ese listado hecho: es un PDF, o la
--     foto de una carta. Poder adjuntarlo es la diferencia entre que carguen
--     la información y que no la carguen.
--
--  2. RESPONSABLE. Si una entrada dice quién la atiende, la consulta sobre
--     ese tema puede caer directamente en esa persona en vez de en el montón.
--
-- QUÉ ES LO QUE LEE LA IA, que es la decisión de fondo de esta migración:
-- NO el archivo. El TEXTO del archivo, extraído UNA sola vez cuando se sube
-- y guardado en `texto`. Mandar el PDF en cada conversación sería pagarlo en
-- cada mensaje de cada persona, todos los días, para siempre. Es el mismo
-- criterio que ya usa `message_media.transcript` con los audios: el adjunto
-- se convierte en texto en el momento en que llega, y de ahí en adelante el
-- sistema trabaja con texto.
--
-- Es aditiva entera: una columna nullable y una tabla nueva. El código de
-- ayer funciona igual con este esquema puesto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quién atiende este tema.
-- ---------------------------------------------------------------------
alter table business_knowledge
  add column if not exists assigned_user_id uuid references users(id) on delete set null;

comment on column business_knowledge.assigned_user_id is
  'Quién atiende las consultas sobre este tema. Cuando el asistente '
  'identifica que la consulta va por acá, la conversación queda a cargo de '
  'esta persona. NULL = nadie en particular, que es lo normal para horarios '
  'o dirección: no todo tema tiene un encargado.';

create index if not exists business_knowledge_responsable
  on business_knowledge (tenant_id, assigned_user_id)
  where assigned_user_id is not null;

-- ---------------------------------------------------------------------
-- 2. Los archivos de cada entrada.
--
-- Los BYTES van en Postgres y no en un volumen, por la misma razón que
-- `message_media` (ver 0019): el respaldo de este sistema es `pg_dump` y
-- nada más. Un archivo en disco quedaría afuera de la copia, y al restaurar
-- el sistema arrancaría con la lista de precios vacía sin un solo error.
--
-- Acá pesa todavía más que con los adjuntos de un paciente: esto es lo que
-- el asistente usa para contestar. Restaurar sin los archivos sería
-- restaurar una IA que de golpe no sabe los precios.
-- ---------------------------------------------------------------------
create table if not exists business_knowledge_files (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  entry_id    uuid not null references business_knowledge(id) on delete cascade,

  filename    text not null,
  mime        text,
  size_bytes  int not null default 0,
  -- El contenido original. Se guarda para poder abrirlo y releerlo: el día
  -- que el modelo lea mal una lista de precios, hay que poder mandarla de
  -- nuevo sin pedirle el archivo otra vez al cliente.
  bytes       bytea,

  /**
   * Lo que se leyó del archivo. ESTO es lo único que llega al prompt.
   *
   * Se extrae una vez, al subirlo. Queda a la vista en la pantalla para que
   * el dueño pueda controlarlo antes de que el asistente empiece a decirlo:
   * un precio mal leído es un compromiso comercial con un cliente, y es
   * mucho más barato verlo acá que en un chat.
   */
  texto       text,

  -- leyendo | listo | error. Arranca en 'leyendo' porque la lectura pasa
  -- después de guardar: que falle no puede hacer que se pierda el archivo,
  -- que es lo único que no se recupera solo.
  estado      text not null default 'leyendo',
  error       text,

  subido_por  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger business_knowledge_files_touch before update on business_knowledge_files
  for each row execute function touch_updated_at();

create index if not exists business_knowledge_files_entrada
  on business_knowledge_files (entry_id, created_at);

alter table business_knowledge_files enable row level security;

create policy business_knowledge_files_rw on business_knowledge_files
  for all to crm_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

grant select, insert, update, delete on business_knowledge_files to crm_app;
-- El worker escribe acá: la lectura del archivo corre fuera de la sesión de
-- quien lo subió, porque tarda más que un formulario.
grant select, insert, update, delete on business_knowledge_files to crm_worker;

comment on table business_knowledge_files is
  'Archivos adjuntos a una entrada de información del negocio: la lista de '
  'precios en PDF, la foto de la carta. La IA lee `texto`, nunca los bytes.';

-- ---------------------------------------------------------------------
-- 3. El asistente ya puede repartir conversaciones.
--
-- La 0025 le sacó al worker la escritura sobre `conversation_assignments`
-- con este comentario textual: "El worker todavía no escribe acá: hoy no hay
-- reparto automático". Hoy lo hay — es este punto — así que se le devuelve,
-- y SOLO insert: un historial que se puede reescribir no es un historial.
-- ---------------------------------------------------------------------
grant insert on conversation_assignments to crm_worker;
revoke update, delete on conversation_assignments from crm_worker;

-- ---------------------------------------------------------------------
-- 4. El worker necesita saber si la persona todavía entra al sistema.
--
-- La 0002 le dejó a `crm_worker` una ventana angosta sobre `users` —solo
-- `id`, `email` y `name`— y eso está bien: el worker no tiene nada que hacer
-- con el resto de la fila. Pero ahora reparte conversaciones, y asignarle un
-- hilo a alguien que ya no entra lo manda a una bandeja que nadie abre. Es
-- exactamente lo que `derivarConversacion` evita del lado de las personas.
--
-- Una columna más, de solo lectura, y ninguna otra.
-- ---------------------------------------------------------------------
grant select (disabled_at) on users to crm_worker;
