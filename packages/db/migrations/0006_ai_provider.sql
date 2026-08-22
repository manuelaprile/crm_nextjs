-- =====================================================================
-- PROVEEDOR DE IA POR CONSULTORIO
-- ---------------------------------------------------------------------
-- Hasta acá el agente hablaba solo con Anthropic y la clave venía por
-- variable de entorno, igual para todos. Se agrega:
--
--   provider     → 'anthropic' | 'openai'
--   api_key_enc  → la clave del cliente, CIFRADA (AES-256-GCM)
--
-- Si `api_key_enc` está vacío se usa la clave de la plataforma (variable de
-- entorno). Eso permite los dos modelos de negocio: el consultorio trae su
-- propia clave y paga su consumo, o lo paga la plataforma dentro del plan.
--
-- La clave NUNCA se guarda en claro: se cifra en la aplicación con la misma
-- SESSION_ENC_KEY que protege las sesiones de WhatsApp. Un dump de la base
-- no alcanza para robar las claves de API de los clientes.
-- =====================================================================

alter table agent_configs
  add column if not exists provider text not null default 'anthropic',
  add column if not exists api_key_enc jsonb,
  -- Solo para mostrar en el panel: "sk-...4f2a". Nunca la clave entera.
  add column if not exists api_key_hint text;

alter table agent_configs
  drop constraint if exists agent_configs_provider_check;
alter table agent_configs
  add constraint agent_configs_provider_check
  check (provider in ('anthropic', 'openai'));

comment on column agent_configs.api_key_enc is
  'Clave de API del cliente, cifrada con AES-256-GCM. Nunca en claro.';

-- ---------------------------------------------------------------------
-- La clave cifrada NO se expone al panel en lecturas normales: la columna
-- se revoca para el rol de la app y solo la lee el camino de sistema
-- (crm_worker), que es el que arma la llamada al modelo.
--
-- El panel sí puede ESCRIBIRLA (para configurarla) y leer el hint.
-- ---------------------------------------------------------------------
revoke select on agent_configs from crm_app;
grant select (id, tenant_id, channel, enabled, assistant_name, system_prompt,
              model, enabled_tools, max_turns, handoff_keywords,
              business_hours, faq, updated_at, provider, api_key_hint)
  on agent_configs to crm_app;
grant insert, update, delete on agent_configs to crm_app;
