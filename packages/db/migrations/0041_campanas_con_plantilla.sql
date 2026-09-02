-- =====================================================================
-- LA CAMPAÑA SE MANDA CON UNA PLANTILLA, NO CON TEXTO LIBRE
-- ---------------------------------------------------------------------
-- Fuera de la ventana de 24 h WhatsApp solo deja salir una plantilla
-- aprobada por Meta, y una campaña por definición le escribe a gente que no
-- escribió recién. Así que el texto libre que guardaba `campanas.mensaje` no
-- se puede mandar nunca: lo que sale es el texto APROBADO, y lo único que
-- varía son sus huecos ({{1}}, {{2}}).
--
-- QUÉ SE GUARDA ACÁ Y QUÉ NO
-- ---------------------------------------------------------------------
-- El NOMBRE de la plantilla y sus valores, no el texto. El texto vive en
-- Meta y puede cambiar —una edición, un rechazo, una nueva versión— y una
-- copia local envejecería en silencio: la pantalla mostraría una cosa y
-- saldría otra. Se lee de Zernio cada vez, que es la fuente.
--
-- `mensaje` NO se borra en este deploy. La regla es que las migraciones sean
-- aditivas en la actualización que cambia el código, así la versión vieja y
-- la nueva conviven un rato y se puede volver atrás. Además tiene lo que la
-- gente escribió antes de esto, y sirve para redactar la plantilla.
-- =====================================================================

alter table campanas add column if not exists plantilla text;
alter table campanas add column if not exists plantilla_idioma text;

-- Los valores de los huecos, EN ORDEN: ["Juan", "10 de octubre"]. Un array y
-- no un objeto porque Meta los pide posicionales, y llamarlos por nombre acá
-- obligaría a traducir de un lado al otro por nada.
alter table campanas add column if not exists plantilla_params jsonb
  not null default '[]'::jsonb;

comment on column campanas.plantilla is
  'Nombre de la plantilla aprobada en Meta. El TEXTO no se guarda: vive en '
  'Meta y se lee de Zernio, porque una copia local envejece en silencio.';
comment on column campanas.plantilla_params is
  'Los valores de los huecos de la plantilla, en orden. Array, no objeto: '
  'Meta los pide posicionales.';
comment on column campanas.mensaje is
  'LEGADO desde la 0041: lo que se manda es la plantilla. Se deja porque '
  'tiene lo que la gente escribió antes y sirve para redactarla; borrar en '
  'un deploy posterior.';
