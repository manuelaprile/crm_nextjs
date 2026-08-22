-- =====================================================================
-- BÚSQUEDA QUE IGNORA ACENTOS
-- ---------------------------------------------------------------------
-- Buscar "cordoba" no encontraba "Córdoba", ni "maria" a "María". En
-- Argentina la gente escribe sin tildes la mitad de las veces, así que la
-- búsqueda tiene que ser indiferente a eso.
--
-- El detalle técnico: `unaccent()` es STABLE, no IMMUTABLE, porque depende
-- del diccionario cargado. Postgres no deja indexar una expresión que no sea
-- IMMUTABLE. La solución estándar es envolverla fijando el diccionario, que
-- sí la hace determinística.
-- =====================================================================

create or replace function inmutable_unaccent(text)
returns text
language sql immutable strict parallel safe as $fn$
  select public.unaccent('public.unaccent'::regdictionary, $1)
$fn$;

-- Índices sobre la versión sin acentos: sin esto la búsqueda haría un
-- recorrido completo de la tabla en cada tecla.
create index if not exists contacts_nombre_sin_acentos
  on contacts using gin (inmutable_unaccent(display_name) gin_trgm_ops);

create index if not exists contacts_ciudad_sin_acentos
  on contacts using gin (inmutable_unaccent(city) gin_trgm_ops);

grant execute on function inmutable_unaccent(text) to crm_app, crm_worker;
