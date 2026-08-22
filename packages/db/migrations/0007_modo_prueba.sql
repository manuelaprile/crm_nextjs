-- =====================================================================
-- MODO PRUEBA
-- ---------------------------------------------------------------------
-- Permite ejercitar el circuito completo sin un WhatsApp real ni una clave
-- de API con saldo:
--
--   provider = 'mock' en agent_configs    -> IA simulada, guion fijo
--   provider = 'mock' en channel_accounts -> los envíos no salen a WhatsApp
--
-- Es la misma idea que ya estaba en la arquitectura del cliente: mientras no
-- haya credenciales reales, cada proveedor tiene su versión simulada que
-- respeta la misma firma y los mismos estados. Así el flujo se prueba entero
-- desde el día uno.
-- =====================================================================

alter table agent_configs drop constraint if exists agent_configs_provider_check;
alter table agent_configs
  add constraint agent_configs_provider_check
  check (provider in ('anthropic', 'openai', 'mock'));
