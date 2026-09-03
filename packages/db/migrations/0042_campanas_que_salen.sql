-- ---------------------------------------------------------------------
-- 0042 — La campaña se manda de verdad
-- ---------------------------------------------------------------------
-- Hasta acá una campaña era un borrador y nada más: el botón de enviar
-- estaba apagado a mano en el componente.
--
-- El envío NO lo hacemos nosotros. Zernio ya tiene difusiones
-- (`/v1/broadcasts`), y delegarle eso nos ahorra escribir una cola con
-- reintentos, ritmo por tier y estado por destinatario —que es
-- exactamente donde se rompen estas cosas—. Nosotros guardamos el id de
-- la difusión y le preguntamos cómo viene.
--
-- Aditiva: ninguna columna se toca ni se borra, así que el deploy vuelve
-- atrás sin perder nada.
-- ---------------------------------------------------------------------

alter table campanas add column if not exists zernio_broadcast_id text;
alter table campanas add column if not exists enviada_en timestamptz;
alter table campanas add column if not exists error_envio text;

comment on column campanas.zernio_broadcast_id is
  'Id de la difusión en Zernio. Es la fuente de verdad de qué salió y qué '
  'no: acá no llevamos estado por destinatario, lo lleva ella.';

comment on column campanas.enviada_en is
  'Cuándo se mandó a enviar. Con esto puesto la campaña NO se edita más: '
  'los mensajes ya salieron y editarla mentiría sobre lo que se mandó.';

comment on column campanas.error_envio is
  'Lo último que contestó Zernio si el envío falló. Se muestra tal cual: '
  'los errores de Meta nombran el campo, y traducirlos pierde el dato.';

comment on column campanas.estado is
  'borrador | enviando | enviada | error. Sin enum a propósito: agregar un '
  'valor a un enum en Postgres es más caro que validarlo en el código.';
