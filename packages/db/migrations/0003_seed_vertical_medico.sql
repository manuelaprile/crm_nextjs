-- =====================================================================
-- VERTICAL MÉDICO — plantilla de arranque
-- ---------------------------------------------------------------------
-- Las 4 etapas salen textuales de lo que pidió el Dr. Echeverría:
--   "personas que entran para preguntar más info y chusmear, cuánto vale
--    una operación / que ya avanzó un poquito más y necesita tal vez
--    hacérsela / el que fue una visita al consultorio / el que se operó"
-- Más una quinta de descarte, que todo embudo necesita para no ensuciar la
-- tasa de conversión con gente que nunca iba a operarse.
--
-- Esto es una FUNCIÓN, no un INSERT suelto: se aplica al crear cada tenant
-- médico nuevo. Las etapas después las renombra el cliente desde el panel.
-- =====================================================================

create or replace function seed_vertical_medico(p_tenant_id uuid)
returns void
language plpgsql as $fn$
begin
  -- ---------------- Etapas del embudo ----------------
  insert into stages (tenant_id, key, name, color, position, is_initial, is_won, is_lost)
  values
    (p_tenant_id, 'consulta',   'Consulta inicial',      '#94A3B8', 0, true,  false, false),
    (p_tenant_id, 'interesado', 'Interesado real',       '#3B82F6', 1, false, false, false),
    (p_tenant_id, 'consultorio','Visitó el consultorio', '#8B5CF6', 2, false, false, false),
    (p_tenant_id, 'operado',    'Se operó',              '#10B981', 3, false, true,  false),
    (p_tenant_id, 'descartado', 'Descartado',            '#EF4444', 4, false, false, true)
  on conflict (tenant_id, key) do nothing;

  -- ---------------- Etiquetas base ----------------
  -- El doctor las pidió para segmentar la publicidad: zona y tipo de consulta.
  insert into tags (tenant_id, name, color) values
    (p_tenant_id, 'Obra social',      '#0EA5E9'),
    (p_tenant_id, 'Particular',       '#F59E0B'),
    (p_tenant_id, 'Derivado',         '#8B5CF6'),
    (p_tenant_id, 'Vino por Instagram','#EC4899'),
    (p_tenant_id, 'Fuera de zona',    '#6B7280'),
    (p_tenant_id, 'Reprogramar',      '#F97316')
  on conflict (tenant_id, name) do nothing;

  -- ---------------- Campos custom ----------------
  -- COMERCIALES, no clínicos. Ver la regla del vertical médico en CLAUDE.md:
  -- nada de diagnóstico ni detalle de la patología. "Motivo" es de texto libre
  -- y la IA tiene prohibido llenarlo con información clínica.
  insert into custom_field_defs (tenant_id, key, label, type, options, position)
  values
    (p_tenant_id, 'motivo', 'Motivo de consulta', 'text', '[]'::jsonb, 0),
    (p_tenant_id, 'cobertura', 'Cobertura', 'select',
      '["Particular","OSDE","Swiss Medical","Galeno","PAMI","Otra","No informa"]'::jsonb, 1),
    (p_tenant_id, 'como_nos_conocio', 'Cómo nos conoció', 'select',
      '["Instagram","Facebook","Google","Derivación","Conocido","Otro"]'::jsonb, 2),
    (p_tenant_id, 'fecha_consultorio', 'Fecha de visita al consultorio', 'date', '[]'::jsonb, 3),
    (p_tenant_id, 'fecha_cirugia', 'Fecha de cirugía', 'date', '[]'::jsonb, 4)
  on conflict (tenant_id, key) do nothing;

  -- ---------------- Agente de IA ----------------
  -- Arranca APAGADO (enabled=false). Se prende cuando el doctor leyó y aprobó
  -- el prompt. Ver la regla "los canales nuevos arrancan apagados".
  insert into agent_configs (
    tenant_id, channel, enabled, assistant_name, model,
    enabled_tools, max_turns, handoff_keywords, system_prompt
  ) values (
    p_tenant_id, 'whatsapp', false, 'Asistente', 'claude-haiku-4-5',
    array['get_contact','set_stage','add_tag','add_note','set_custom_field','handoff'],
    6,
    -- Cualquiera de estas dispara pase a humano INMEDIATO, sin responder nada más.
    array['dolor','me duele','urgente','urgencia','emergencia','sangra','sangrado',
          'fiebre','infección','infectado','complicación','me operé y','post operatorio',
          'postoperatorio','reclamo','abogado','denuncia','pus','puntos','herida'],
    -- Prompt mínimo. La versión completa con rol de secretaria la instala la
    -- migración 0008, que también reescribe esta función. Se deja algo acá
    -- para que 0003 sea autocontenida: una migración no puede depender de
    -- otra posterior.
    $prompt$Sos la secretaria del consultorio. Instrucciones pendientes de
completar: ver docs/prompt-secretaria.md.$prompt$
  )
  on conflict (tenant_id, channel) do nothing;
end
$fn$;
