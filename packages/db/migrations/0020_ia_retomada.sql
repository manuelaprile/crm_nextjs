-- ---------------------------------------------------------------------
-- Cuándo volvió la conversación a manos de la IA.
--
-- El agente arma su contexto leyendo los últimos 30 mensajes del hilo, sin
-- ninguna marca de qué pasó en el medio. Cuando una persona toma una
-- conversación, la atiende y después se la devuelve a la IA, el agente vuelve
-- a leer el "quiero hablar con alguien" de hace tres días y hace exactamente
-- lo que dice: deriva de nuevo.
--
-- Desde afuera parece que el botón de "que vuelva a atender la IA" no
-- funciona: se prende, entra un mensaje, y la conversación salta de vuelta a
-- humano con una nota nueva. Pasó de verdad y así se encontró.
--
-- Con esta fecha, el historial que ve el agente lleva una marca explícita en
-- el punto donde una persona atendió y la IA retomó, y el prompt le dice que
-- los pedidos anteriores a esa marca ya fueron atendidos. El historial NO se
-- recorta: ahí están el nombre, el motivo de consulta y todo lo que el
-- paciente ya contó, y hacérselo preguntar de nuevo sería peor que el bug.
-- ---------------------------------------------------------------------

alter table conversations
  add column if not exists ai_resumed_at timestamptz;

comment on column conversations.ai_resumed_at is
  'Cuándo se volvió a activar la IA después de que la atendiera una persona. '
  'Marca el corte entre "lo que ya se atendió" y "lo que es nuevo" para el '
  'agente. Null = nunca pasó a humano, o nunca volvió.';

-- No hace falta ningún permiso nuevo: `conversations` no tiene permisos por
-- columna, así que crm_app ya puede escribirla con el grant de tabla de la
-- 0002. Y está bien que pueda: prender y apagar la IA en una conversación es
-- una acción normal de la secretaria, no del sistema.
