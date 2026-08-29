-- ---------------------------------------------------------------------
-- Lo que la tarjeta del tablero tiene que poder mostrar.
--
-- El tablero mostraba nombre, zona y teléfono. Con eso, para saber si a
-- alguien había que llamarlo hoy había que abrir su ficha, y con veinte
-- contactos eso son veinte pantallas. La tarjeta nueva contesta de un
-- vistazo: de qué es la consulta, en qué anda, cuándo es lo próximo y a
-- quién le toca.
--
-- Casi todo eso ya estaba en la base y solo faltaba juntarlo: las etiquetas,
-- los turnos, las etapas con su `is_won`/`is_lost`. Lo único que no existía
-- es el asunto.
-- ---------------------------------------------------------------------

alter table contacts
  add column if not exists asunto text;

comment on column contacts.asunto is
  'De qué es la consulta, en una línea: "Consulta por casa en Barrio Norte". '
  'Lo escribe una persona desde la ficha; más adelante lo va a completar el '
  'asistente. Es COMERCIAL, no clínico (ver CLAUDE.md).';

-- ---------------------------------------------------------------------
-- El responsable del contacto.
--
-- La columna existía desde la 0001 y nunca se usó. Ahora significa algo:
-- es quién sigue a esta persona, y asignarla desde el tablero les pone
-- dueño de paso a las conversaciones suyas que no lo tuvieran.
-- ---------------------------------------------------------------------
comment on column contacts.owner_user_id is
  'Quién sigue a este contacto. Asignarlo también le pone responsable a sus '
  'conversaciones SIN asignar; las que ya tenían dueño no se tocan, porque '
  'esa fue una decisión de alguien y no la pisa un efecto secundario.';

create index if not exists contacts_responsable
  on contacts (tenant_id, owner_user_id)
  where archived_at is null;

-- Para el "Próxima acción" de cada tarjeta: el turno más cercano de cada
-- contacto. El índice que ya había va por (contact_id, starts_at desc) y
-- sirve para el historial; este es el de lo que viene.
create index if not exists appointments_proximos
  on appointments (tenant_id, contact_id, starts_at)
  where status = 'programada';
