-- =====================================================================
-- CANARIO DE CIFRADO
-- ---------------------------------------------------------------------
-- Guarda un valor conocido, cifrado con la clave del sistema.
--
-- Para qué: si alguien cambia o pierde SESSION_ENC_KEY, hoy el problema
-- aparece recién cuando un cliente intenta usar su WhatsApp — y se
-- manifiesta como "la sesión no levanta", que no dice nada sobre la causa
-- real. Con el canario, el arranque detecta la clave equivocada de
-- inmediato y lo dice con todas las letras.
--
-- No es un secreto: el texto en claro es siempre el mismo y conocido. Lo
-- único que prueba es que la clave configurada es la que cifró los datos
-- que ya están guardados.
-- =====================================================================

create table if not exists cifrado_canario (
  id          int primary key default 1 check (id = 1),
  valor       jsonb not null,
  creado_at   timestamptz not null default now(),
  rotado_at   timestamptz
);

comment on table cifrado_canario is
  'Valor conocido cifrado con SESSION_ENC_KEY. Sirve para detectar al '
  'arrancar que la clave configurada corresponde a los datos guardados.';

-- Lo escribe y lo lee el camino de sistema; el panel no lo necesita.
grant select, insert, update on cifrado_canario to crm_worker;
grant select on cifrado_canario to crm_app;
