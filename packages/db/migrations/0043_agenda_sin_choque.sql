-- ---------------------------------------------------------------------
-- 0043 — La agenda deja de rechazar turnos superpuestos
-- ---------------------------------------------------------------------
-- Pedido del negocio, y tiene sentido para el rubro: la disponibilidad
-- real la termina definiendo un asesor, no el sistema. Decirle a alguien
-- "no hay lugar el martes" cuando el martes se puede acomodar es perder
-- una visita por una regla que el negocio no tiene.
--
-- Antes, `appointments_sin_superposicion` (0023) rechazaba el segundo
-- turno que pisara a otro. Estaba en la base y no en el código porque la
-- IA agenda sola y dos conversaciones simultáneas pueden pedir el mismo
-- horario. Esa carrera sigue existiendo: lo que cambia es que ahora el
-- resultado deseado es que entren las dos.
--
-- ATENCIÓN, ESTO NO SE DESHACE SOLO. Volver atrás es re-crear la
-- restricción, y eso FALLA si para entonces ya hay dos turnos pisados en
-- alguna cuenta. Habría que encontrarlos y moverlos primero:
--
--   select a.tenant_id, a.id, a.starts_at, a.ends_at, a.titulo
--     from appointments a join appointments b
--       on b.tenant_id = a.tenant_id and b.id <> a.id
--      and tstzrange(a.starts_at, a.ends_at, '[)')
--       && tstzrange(b.starts_at, b.ends_at, '[)')
--    where a.status in ('programada','cumplida')
--      and b.status in ('programada','cumplida')
--    order by a.tenant_id, a.starts_at;
--
-- El resto de las validaciones NO se toca: horario de atención,
-- anticipación mínima y horizonte siguen valiendo. Lo único que se cae
-- es "ese horario ya está ocupado".
-- ---------------------------------------------------------------------

alter table appointments drop constraint if exists appointments_sin_superposicion;

comment on table appointments is
  'Los turnos del negocio. Dos turnos PUEDEN pisarse desde la 0043: la '
  'disponibilidad real la define un asesor y el sistema no la adivina. '
  'Lo que sí se sigue validando cuando agenda la IA es el horario de '
  'atención, la anticipación mínima y el horizonte.';
