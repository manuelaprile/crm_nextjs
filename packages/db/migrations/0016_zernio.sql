-- ---------------------------------------------------------------------
-- Tercer proveedor del canal de WhatsApp: Zernio
--
-- `channel` sigue siendo 'whatsapp'. `provider` ahora puede ser:
--   baileys    QR, no oficial, riesgo de bloqueo
--   cloud_api  oficial de Meta, alta manual, el número sale de la app
--   zernio     oficial de Meta a través de un socio aprobado
--
-- Lo que aporta Zernio y no teníamos: el alta es un botón (Embedded Signup,
-- porque el Tech Provider son ellos) y soporta COEXISTENCE — el número
-- sigue funcionando en la aplicación de WhatsApp del celular mientras los
-- mensajes entran por la API. Con `cloud_api` a secas eso no se puede.
--
-- Igual que la 0015: son columnas nuevas, nada de acá toca Baileys ni el
-- canal oficial. Las cuentas que ya existen quedan en null.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- El "profile" de Zernio es su unidad de aislamiento: un espacio de trabajo
-- con sus propias cuentas conectadas. Se mapea uno a uno con nuestro tenant,
-- y por eso vive acá y no en channel_accounts: es del consultorio, no del
-- número. Sin esto, las cuentas de todos los clientes caerían en el mismo
-- espacio y cualquier error de ruteo mezclaría pacientes de dos consultorios.
-- ---------------------------------------------------------------------
alter table tenants
  add column if not exists zernio_profile_id text;

comment on column tenants.zernio_profile_id is
  'Id del profile (espacio de trabajo) de este consultorio en Zernio. Se crea '
  'la primera vez que se conecta un número por ese proveedor.';

create unique index if not exists tenants_zernio_profile
  on tenants (zernio_profile_id) where zernio_profile_id is not null;

comment on column channel_accounts.external_id is
  'Baileys: el JID propio. Cloud API: el phone_number_id de Meta. Zernio: el '
  'id de la cuenta social conectada. En los tres casos es la clave por la que '
  'se rutea lo que entra, y por eso comparten columna: el índice único '
  '(provider, external_id) ya los separa.';

-- ---------------------------------------------------------------------
-- Escribir esta columna a mano permitiría apuntar el consultorio al espacio
-- de trabajo de otro cliente y quedarse con sus conversaciones. No hace
-- falta revocar nada nuevo: la 0014 ya acotó el update de `tenants` a
-- (name, timezone, locale), así que crm_app no puede tocarla. La escribe
-- solo el camino de sistema, que es el que habló con Zernio y sabe qué id
-- le devolvieron.
--
-- Leerla sí puede, por el grant de tabla de la 0002. No es un problema: el
-- id del profile no sirve para nada sin la API key, que vive en el entorno
-- del servidor y nunca llega al navegador.
-- ---------------------------------------------------------------------
