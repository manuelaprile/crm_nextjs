-- =====================================================================
-- ÍNDICES PARA LA LISTA PAGINADA DE CONTACTOS
-- ---------------------------------------------------------------------
-- Con 300 contactos no se nota; con 20.000 sí. Se agregan ahora porque
-- crear un índice sobre una tabla grande y en uso es mucho más molesto
-- que crearlo sobre una vacía.
-- =====================================================================

-- Orden por defecto de la lista.
create index if not exists contacts_lista
  on contacts (tenant_id, last_activity_at desc nulls last, created_at desc)
  where archived_at is null;

-- La vista de archivados.
create index if not exists contacts_archivados
  on contacts (tenant_id, last_activity_at desc nulls last)
  where archived_at is not null;

-- Búsqueda por teléfono y por zona (el nombre ya tenía índice trigram).
create index if not exists contacts_phone_trgm
  on contacts using gin (phone gin_trgm_ops);
create index if not exists contacts_city_trgm
  on contacts using gin (city gin_trgm_ops);
