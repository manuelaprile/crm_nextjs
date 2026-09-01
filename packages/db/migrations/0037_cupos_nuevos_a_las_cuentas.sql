-- =====================================================================
-- LOS CUPOS NUEVOS TAMBIÉN PARA LAS CUENTAS QUE YA ESTÁN
-- ---------------------------------------------------------------------
-- La 0036 bajó Start a 300 y Pro a 900 solo para las cuentas nuevas, y dejó
-- a las que ya existían en los 500 que les había puesto la 0034. Decisión
-- del dueño del producto el 01/09/2026: se aplica a todas.
--
-- ES UNA BAJA DE LÍMITE Y NO SE PUEDE DESHACER SOLA. Una cuenta Start que
-- este mes ya lleva más de 300 conversaciones se queda sin asistente en el
-- acto, hasta el 1º. No es un bug: es lo que significa bajar el cupo a mitad
-- de mes. Antes de actualizar conviene mirar quién está arriba del número
-- nuevo (la consulta está abajo, en el comentario final).
--
-- QUÉ SE TOCA Y QUÉ NO
-- ---------------------------------------------------------------------
-- Solo `ai_monthly_conversation_cap`, y solo donde todavía vale 500, que es
-- exactamente el valor que dejó el relleno de la 0034: "acá no decidió nadie".
-- Una cuenta con 750 porque se lo negociaron no se toca, y por eso la
-- condición mira el valor viejo y no solo el plan.
--
-- `max_users`, `max_wa_accounts` y el tope de gasto NO se tocan. Ahí sí hay
-- excepciones negociadas —"Start pero con 5 usuarios"— y alinearlas por el
-- nombre del plan las borraría sin que nadie se entere. Eso se ajusta de a
-- una desde Plataforma → la cuenta → Plan, que además deja constancia.
--
-- Los números están escritos acá y no salen de `lib/planes.ts` a propósito:
-- una migración es un hecho fechado, no una lectura del catálogo de hoy. Si
-- mañana Start pasa a 400, esta migración tiene que seguir diciendo 300,
-- porque eso es lo que pasó.
-- =====================================================================

update tenants set ai_monthly_conversation_cap = 300
 where plan = 'starter' and ai_monthly_conversation_cap = 500;

update tenants set ai_monthly_conversation_cap = 900
 where plan = 'pro' and ai_monthly_conversation_cap = 500;

-- Business no se toca: su cupo se carga por cuenta al cerrar la venta.

-- Para mirar antes de actualizar, si hace falta:
--
--   select t.slug, t.plan, t.ai_monthly_conversation_cap as cupo_hoy,
--          (select count(distinct r.conversation_id) from ai_runs r
--            where r.tenant_id = t.id and r.conversation_id is not null
--              and r.created_at >= mes_desde(mes_en_curso(t.timezone),
--                                            t.timezone)) as usadas_este_mes
--     from tenants t order by t.slug;
