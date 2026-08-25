-- ---------------------------------------------------------------------
-- Canal oficial: WhatsApp Cloud API
--
-- El segundo proveedor del mismo canal. `channel` sigue siendo 'whatsapp';
-- lo que cambia es `provider`: 'baileys' (QR, no oficial) o 'cloud_api'
-- (oficial, por Meta). Los dos conviven en la misma cuenta y en las mismas
-- pantallas, que es exactamente para lo que existe la separación entre canal
-- y proveedor desde el día uno. Ver CLAUDE.md, punto 1 del modelo conceptual.
--
-- NADA de esta migración toca el camino de Baileys. Son columnas nuevas que
-- quedan en null para las cuentas que ya existen.
-- ---------------------------------------------------------------------

alter table channel_accounts
  add column if not exists waba_id    text,
  add column if not exists token_enc  jsonb,
  add column if not exists token_hint text;

comment on column channel_accounts.external_id is
  'Baileys: el JID propio. Cloud API: el phone_number_id de Meta. En los dos '
  'casos es la clave por la que se rutea lo que entra, y por eso comparten '
  'columna: el índice único (provider, external_id) ya los separa.';

comment on column channel_accounts.waba_id is
  'Cloud API: id de la WhatsApp Business Account dueña del número.';

comment on column channel_accounts.token_enc is
  'Cloud API: el access token del cliente, cifrado con AES-256-GCM igual que '
  'la clave de IA y el auth state de WhatsApp. Con este token se puede mandar '
  'mensajes en nombre del cliente: no viaja nunca en texto plano.';

comment on column channel_accounts.token_hint is
  'Los últimos caracteres del token, para que el panel pueda mostrar cuál '
  'está cargado sin poder leerlo.';

-- ---------------------------------------------------------------------
-- El panel no puede leer el token, ni siquiera cifrado.
--
-- La política `channel_accounts_read` deja que TODO el tenant haga select
-- —la secretaria necesita ver si WhatsApp está conectado— así que sin esto
-- el token quedaría al alcance de cualquier usuario de la cuenta. Va por
-- permisos de columna, como los límites del plan en la 0014: un comentario
-- que dice "esto no se toca" no impide nada.
--
-- Quien sí lo lee es `crm_worker`, que es el camino de sistema y no pasa por
-- una sesión de usuario.
-- ---------------------------------------------------------------------
revoke select on channel_accounts from crm_app;
grant select (
  id, tenant_id, channel, provider, external_id, label, phone,
  status, qr, qr_expires_at, last_error, connected_at, last_seen_at,
  created_at, updated_at, waba_id, token_hint
) on channel_accounts to crm_app;

-- Y tampoco puede escribirlo a mano: se carga por el camino de sistema, que
-- es el único que sabe cifrarlo.
revoke update on channel_accounts from crm_app;
grant update (
  label, status, qr, qr_expires_at, last_error, external_id, phone,
  connected_at, last_seen_at
) on channel_accounts to crm_app;
