-- ---------------------------------------------------------------------
-- Lo que el asistente sabe: del negocio y del contacto.
--
-- Hasta ahora el agente recibía UNA sola cosa: el texto de instrucciones y
-- los últimos mensajes del hilo. Nada más. No veía el nombre del contacto, ni
-- su ciudad, ni la etapa, ni las notas —ni siquiera las que había escrito él
-- mismo—, ni un solo dato del negocio que no estuviera copiado a mano dentro
-- de las instrucciones.
--
-- La consecuencia se veía todos los días: derivaba a un humano por preguntas
-- que debería contestar. El caso que lo destapó fue textual: "el usuario pidió
-- hablar con un humano para obtener más detalles y PRECIOS". No sabía los
-- precios porque no había dónde cargarlos.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Conocimiento del negocio: precios, horarios, servicios, lo que sea.
--
-- Entradas sueltas y no un textarea gigante: se editan de a una, se pueden
-- ordenar, y cada una lleva su propia fecha. Eso último importa más de lo que
-- parece — una lista de precios vieja es PEOR que ninguna, porque el
-- asistente la va a decir con total seguridad y eso es un compromiso
-- comercial con un cliente. La fecha permite avisar cuando envejece.
-- ---------------------------------------------------------------------
create table business_knowledge (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  titulo      text not null,
  contenido   text not null,
  -- Apagar una entrada sin borrarla: precios de temporada, un servicio que
  -- se suspende un mes. Borrar y volver a escribir invita a perder cosas.
  activo      boolean not null default true,
  posicion    int not null default 0,
  actualizado_por uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger business_knowledge_touch before update on business_knowledge
  for each row execute function touch_updated_at();
create index on business_knowledge (tenant_id, posicion);

alter table business_knowledge enable row level security;
create policy business_knowledge_rw on business_knowledge
  for all to crm_app
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on business_knowledge to crm_app;
grant select, insert, update, delete on business_knowledge to crm_worker;

comment on table business_knowledge is
  'Lo que el asistente puede contestar sin derivar: precios, horarios, '
  'servicios. Si algo no está acá, la regla es que NO lo invente y derive.';

-- ---------------------------------------------------------------------
-- Notas: la válvula de escape.
--
-- El asistente pasa a leer las notas del contacto, incluidas las que escriben
-- las personas. Eso es lo pedido y es lo que le da memoria de verdad.
--
-- Pero una nota interna no está escrita para el paciente. "Insiste mucho",
-- "quedó debiendo la consulta anterior", "difícil de tratar" son cosas que el
-- equipo se dice entre sí. Si el asistente las lee, tarde o temprano una se
-- filtra en una respuesta — no hace falta que la copie textual, alcanza con
-- que conteste distinto y se note.
--
-- Por eso cada nota puede marcarse como privada. El valor por defecto es
-- VISIBLE, que es lo que se pidió: la excepción hay que elegirla, no al revés.
-- ---------------------------------------------------------------------
alter table notes
  add column if not exists visible_ia boolean not null default true;

comment on column notes.visible_ia is
  'Si el asistente puede leer esta nota. Por defecto sí. En false queda solo '
  'para el equipo: sirve para lo que se escribe entre nosotros y no debería '
  'influir en cómo se le contesta a la persona.';
