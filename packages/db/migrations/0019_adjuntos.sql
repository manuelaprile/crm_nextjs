-- ---------------------------------------------------------------------
-- Adjuntos: audios, fotos, videos y documentos que manda el paciente.
--
-- Hasta ahora un mensaje con una foto llegaba a la bandeja como el texto
-- literal "[image]". El mensaje se registraba, pero el contenido se perdía.
--
-- Los BYTES van en Postgres, no en un volumen de disco.
--
-- El backup de este sistema es `pg_dump` y nada más (ver infra/backup.sh).
-- Un archivo en un volumen quedaría fuera de la copia, y al restaurar el
-- sistema arrancaría con las conversaciones completas y las fotos vacías,
-- sin un solo error. Para un CRM médico donde alguien manda la foto de una
-- herida, eso es inaceptable. En Postgres, el respaldo es automático y
-- consistente con el mensaje al que pertenece.
--
-- El costo es tamaño de base. Se acota con un tope por archivo (ver
-- MEDIA_MAX_BYTES en lib/media.ts): arriba de eso se guarda la ficha del
-- archivo y no el contenido, y la bandeja lo dice.
-- ---------------------------------------------------------------------

create table message_media (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  message_id   uuid not null references messages(id) on delete cascade,

  -- image | video | audio | document | sticker
  kind         text not null,
  mime         text,
  filename     text,
  size_bytes   int,

  -- El contenido. NULL cuando el archivo superó el tope o no se pudo bajar:
  -- la fila queda igual, porque saber que el paciente mandó algo y no se
  -- pudo guardar es información, y borrarla sería esconder el problema.
  bytes        bytea,

  /**
   * La transcripción del audio.
   *
   * No es un adorno: sin esto el agente recibe un mensaje vacío y contesta
   * cualquier cosa, o no contesta. Con la transcripción, un audio de un
   * paciente se atiende igual que un texto.
   */
  transcript   text,

  -- Qué falló, si falló. En la bandeja se muestra tal cual.
  error        text,

  created_at   timestamptz not null default now()
);

create index on message_media (message_id);
create index on message_media (tenant_id, created_at desc);

alter table message_media enable row level security;

-- Misma regla que el resto: el tenant ve lo suyo y nada más.
create policy message_media_rw on message_media
  for all to crm_app
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on message_media to crm_app;
grant select, insert, update, delete on message_media to crm_worker;

comment on table message_media is
  'Adjuntos entrantes. Los bytes viven acá y no en disco para que entren en '
  'el pg_dump: un volumen no respaldado restauraría conversaciones sin sus '
  'archivos y sin ningún error visible.';
