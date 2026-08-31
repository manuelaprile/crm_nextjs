-- =====================================================================
-- BORRAR UN CONTACTO NO PUEDE BORRAR LO QUE YA CONSUMIÓ
-- ---------------------------------------------------------------------
-- `ai_runs` y `ai_tool_calls` son el registro de consumo: qué hizo la IA,
-- cuántos tokens gastó y cuánto costó. La 0001 los ató a la conversación
-- con `on delete set null`, que para una tabla operativa sería lo correcto
-- —no querés que borrar un contacto se lleve el historial de costos— pero
-- para una tabla de contabilidad hace justo lo que no se quiere: deja la
-- fila y le borra a qué correspondía.
--
-- CÓMO SE VIO. Midiendo el costo real por conversación en producción, el
-- promedio daba USD 0,156 — con eso, un plan de USD 79 por 500
-- conversaciones no cerraba. El número era falso:
--
--   altos-de-don-carlos | 223 corridas | 10 con conversación | 208 huérfanas
--
-- Se habían borrado las conversaciones de prueba, esas 208 filas perdieron
-- su `conversation_id`, y el costo quedó en el numerador con el denominador
-- vacío. El costo real por conversación es USD 0,006: veintiséis veces menos.
--
-- POR QUÉ IMPORTA MÁS QUE UNA MEDICIÓN MAL HECHA. Los planes se venden en
-- conversaciones por mes, y contarlas es `count(distinct conversation_id)`
-- sobre esta tabla. Con la llave como estaba, **un cliente que borra
-- contactos baja su propio contador**: llega a 480 de 500, limpia la
-- bandeja, y vuelve a tener cupo. No hace falta mala fe —archivar y limpiar
-- es una acción normal— pero el que se diera cuenta tenía barra libre.
--
-- EL ARREGLO es sacar la llave foránea, no agregar una columna paralela. El
-- id se queda escrito igual, todo el código que ya lo guarda sigue igual, y
-- no hay una segunda columna que alguien pueda olvidarse de llenar. Que
-- quede apuntando a una conversación borrada es exactamente lo que se
-- quiere: para contar distintos alcanza el valor, y nadie hace join de
-- `ai_runs` contra `conversations` (el único join que existe, `overBudget`
-- en agent.ts, es por `tenant_id`).
--
-- El principio, para la próxima tabla: una fila de contabilidad no pierde
-- datos porque se borró una fila operativa.
--
-- LO QUE NO SE PUEDE RECUPERAR: las 239 filas que ya quedaron en null. Eran
-- conversaciones de prueba, así que no se pierde nada real, pero es el
-- motivo por el que esto va ANTES del contador de planes y no después.
-- =====================================================================

alter table ai_runs       drop constraint if exists ai_runs_conversation_id_fkey;
alter table ai_tool_calls drop constraint if exists ai_tool_calls_conversation_id_fkey;

comment on column ai_runs.conversation_id is
  'Con qué conversación corrió. A propósito SIN llave foránea: es un '
  'registro de consumo y tiene que sobrevivir a que se borre la '
  'conversación, o el contador mensual de los planes se puede vaciar '
  'borrando contactos. Puede apuntar a una fila que ya no existe.';

comment on column ai_tool_calls.conversation_id is
  'Ver el comentario de ai_runs.conversation_id: sin llave foránea a '
  'propósito.';

-- El índice que va a usar el contador de conversaciones del plan. Sin él,
-- la cuenta del mes recorre todas las corridas históricas de la cuenta.
create index if not exists ai_runs_conversaciones_del_mes
  on ai_runs (tenant_id, created_at desc, conversation_id);
