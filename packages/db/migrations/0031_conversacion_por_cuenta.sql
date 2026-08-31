-- =====================================================================
-- UNA CONVERSACIÓN ES DE UNA CUENTA, NO DE UN PROVEEDOR
-- ---------------------------------------------------------------------
-- La 0001 declaró la identidad de una conversación así:
--
--   create unique index conversations_provider_external
--     on conversations (provider, external_id);
--
-- Sin `tenant_id`. Y `external_id` es el JID de QUIEN ESCRIBE, no del
-- negocio. O sea que una misma persona escribiéndole a dos clientes
-- distintos de la plataforma es la MISMA clave: `zernio` +
-- `5492352508414@s.whatsapp.net` en los dos casos.
--
-- LO QUE PASABA, que se vio en producción el 31/08/2026:
--
--   1. La persona ya tenía hilo con el cliente A.
--   2. Le escribe al cliente B. La ingesta crea bien el contacto —eso sí
--      lleva tenant_id, en `contact_identities`— y después hace
--      `insert ... on conflict (provider, external_id) do update`.
--   3. Choca con la conversación del cliente A, **la actualiza a ella** y
--      devuelve su id.
--   4. El mensaje se guarda con el `tenant_id` de B y el `conversation_id`
--      de A.
--
-- Resultado: en B no aparece la conversación, y en A tampoco aparece el
-- mensaje, porque RLS filtra `messages` por `tenant_id`. El mensaje queda
-- invisible desde los dos paneles. Encima el agente corría sobre el hilo de
-- A, y `metadata.zernioConversationId` —la dirección de respuesta— quedaba
-- pisada con la del hilo de B.
--
-- Nada de esto tiró un error. `webhook_events` quedó con processed_at y sin
-- error. Es exactamente el modo de falla que las reglas duras del CLAUDE.md
-- existen para evitar: mensajes que se pierden en silencio.
--
-- LA CLAVE CORRECTA ES `(account_id, external_id)`
--
-- Una conversación es un hilo entre UN número del negocio y UNA persona.
-- `account_id` ya implica el tenant y el proveedor, así que es más preciso
-- que agregarle `tenant_id` a la clave vieja: dos números Zernio de la misma
-- cuenta también son dos hilos distintos, y con `(tenant_id, provider,
-- external_id)` se habrían fusionado igual que ahora.
--
-- El índice nuevo es más DÉBIL que el viejo (todo par que colisiona en
-- `(account_id, external_id)` colisionaba también en `(provider,
-- external_id)`), así que no puede fallar por datos existentes.
--
-- Y ADEMÁS, LAS LLAVES QUE LO VUELVEN IMPOSIBLE
--
-- Cambiar el índice arregla este bug. Las llaves foráneas compuestas del
-- final arreglan la CLASE de bug: con ellas, un mensaje cuyo `tenant_id` no
-- coincida con el de su conversación no se guarda mal, directamente no se
-- guarda. Un `insert` mal escrito pasa de perder un mensaje en silencio a
-- tirar un error que se ve. Es la diferencia entre enterarse por un cliente
-- y enterarse en la primera prueba.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El índice viejo sale PRIMERO.
--
-- La reparación de abajo crea la conversación que faltaba en la cuenta
-- correcta, y esa fila tiene el mismo (provider, external_id) que la de la
-- otra cuenta. Con el índice viejo todavía puesto, la reparación no puede
-- correr.
-- ---------------------------------------------------------------------
drop index if exists conversations_provider_external;

-- ---------------------------------------------------------------------
-- 2. Reparación de lo que ya se rompió.
-- ---------------------------------------------------------------------
create temp table repar_msgs on commit drop as
select m.id          as message_id,
       m.tenant_id   as tenant_id,
       m.channel     as channel,
       m.provider    as provider,
       m.external_id as msg_external,
       m.direction   as direction,
       coalesce(m.sent_at, m.created_at) as sent_at,
       c.id          as conv_vieja,
       c.external_id as jid
  from messages m
  join conversations c on c.id = m.conversation_id
 where m.tenant_id <> c.tenant_id;

do $rep$
declare
  fila       record;
  v_conv     uuid;
  v_cuenta   uuid;
  v_meta     jsonb;
  v_contacto uuid;
  v_nombre   text;
  v_quedan   int;
  v_movidos  int := 0;
begin
  for fila in select * from repar_msgs order by sent_at loop
    -- ---- A qué cuenta pertenecía de verdad ------------------------
    -- El evento original lo dice sin ambigüedad, y de paso trae la
    -- `metadata` del proveedor: para Zernio, el id de conversación que es
    -- la dirección de respuesta. Sin eso el hilo se ve pero no se contesta.
    select (we.payload->>'accountId')::uuid,
           coalesce(we.payload->'metadata', '{}'::jsonb)
      into v_cuenta, v_meta
      from webhook_events we
     where we.tenant_id = fila.tenant_id
       and we.payload->'message'->'key'->>'id' = fila.msg_external
     order by we.received_at desc
     limit 1;

    -- Si el evento ya no está (se purgó, o el mensaje entró por otro
    -- camino), queda el canal de esa cuenta para ese proveedor.
    if v_cuenta is null then
      select ca.id into v_cuenta
        from channel_accounts ca
       where ca.tenant_id = fila.tenant_id and ca.provider = fila.provider
       order by ca.created_at
       limit 1;
      v_meta := '{}'::jsonb;
    end if;

    if v_cuenta is null then
      raise exception
        'El mensaje % es de la cuenta % y no hay ningún canal % donde ponerlo.',
        fila.message_id, fila.tenant_id, fila.provider;
    end if;

    -- ---- El contacto ya existe en la cuenta correcta ---------------
    -- Es lo único que la ingesta sí resolvía bien, porque
    -- `contact_identities` lleva tenant_id.
    select ci.contact_id into v_contacto
      from contact_identities ci
     where ci.tenant_id = fila.tenant_id
       and ci.channel = fila.channel
       and ci.external_id = fila.jid
     limit 1;
    select ct.display_name into v_nombre
      from contacts ct where ct.id = v_contacto;

    -- ---- La conversación que corresponde ---------------------------
    select c2.id into v_conv
      from conversations c2
     where c2.account_id = v_cuenta and c2.external_id = fila.jid
     limit 1;

    if v_conv is null then
      insert into conversations (
        tenant_id, channel, provider, account_id, external_id, contact_id,
        participant_name, participant_phone,
        last_message_at, last_inbound_at, unread_count, metadata
      ) values (
        fila.tenant_id, fila.channel, fila.provider, v_cuenta, fila.jid, v_contacto,
        v_nombre,
        -- Solo si el JID trae un teléfono de verdad. De un `@lid` salen
        -- quince dígitos que no son el número de nadie.
        case when fila.jid like '%@s.whatsapp.net'
             then split_part(split_part(fila.jid, '@', 1), ':', 1) end,
        fila.sent_at, fila.sent_at, 0, v_meta
      ) returning id into v_conv;
    end if;

    update messages set conversation_id = v_conv where id = fila.message_id;
    v_movidos := v_movidos + 1;

    update conversations set
        metadata        = metadata || v_meta,
        last_message_at = greatest(coalesce(last_message_at, fila.sent_at), fila.sent_at),
        last_inbound_at = case when fila.direction = 'inbound'
              then greatest(coalesce(last_inbound_at, fila.sent_at), fila.sent_at)
              else last_inbound_at end,
        unread_count    = unread_count
              + case when fila.direction = 'inbound' then 1 else 0 end
      where id = v_conv;
  end loop;

  -- ---- Devolver la conversación invadida a su estado ---------------
  -- Se le habían sumado no leídos ajenos y se le había estirado la fecha
  -- del último mensaje con mensajes de otra cuenta: aparecía primera en la
  -- bandeja por conversaciones que no eran suyas.
  update conversations c set
      unread_count = greatest(0, c.unread_count - (
        select count(*) from repar_msgs r
         where r.conv_vieja = c.id and r.direction = 'inbound')),
      last_message_at = (select max(coalesce(m.sent_at, m.created_at))
                           from messages m where m.conversation_id = c.id),
      last_inbound_at = (select max(coalesce(m.sent_at, m.created_at))
                           from messages m where m.conversation_id = c.id
                          and m.direction = 'inbound')
    where c.id in (select distinct conv_vieja from repar_msgs);

  -- ---- Y su dirección de respuesta ---------------------------------
  -- `metadata` se fusiona, así que el `zernioConversationId` de la
  -- conversación invadida quedó pisado con el del hilo ajeno. Contestar
  -- ahí habría mandado el mensaje al chat equivocado. Se recupera del
  -- último evento propio; si no hay ninguno, se BORRA la clave: no poder
  -- contestar se ve y se arregla, contestarle a otra persona no.
  update conversations c set
      metadata = (c.metadata - 'zernioConversationId') || coalesce((
        select jsonb_build_object('zernioConversationId',
                 we.payload->'metadata'->>'zernioConversationId')
          from webhook_events we
         where we.tenant_id = c.tenant_id
           and we.payload->'message'->'key'->>'remoteJid' = c.external_id
           and we.payload->'metadata'->>'zernioConversationId' is not null
         order by we.received_at desc
         limit 1), '{}'::jsonb)
    where c.id in (select distinct conv_vieja from repar_msgs)
      and c.provider = 'zernio';

  -- ---- Contactos de otra cuenta colgados de una conversación -------
  -- El `contact_id = coalesce(...)` del upsert podía meter el contacto de
  -- una cuenta en la conversación de otra. Se reapunta al contacto que
  -- corresponde, y si no hay, se deja en null.
  update conversations c set contact_id = (
      select ci.contact_id from contact_identities ci
       where ci.tenant_id = c.tenant_id
         and ci.channel = c.channel
         and ci.external_id = c.external_id
       limit 1)
    where c.contact_id is not null
      and exists (select 1 from contacts ct
                   where ct.id = c.contact_id and ct.tenant_id <> c.tenant_id);

  -- ---- No puede quedar nada -----------------------------------------
  -- Las llaves de abajo lo exigen igual; fallar acá da un error que se
  -- entiende en vez de una violación de constraint.
  select count(*) into v_quedan
    from messages m join conversations c on c.id = m.conversation_id
   where m.tenant_id <> c.tenant_id;
  if v_quedan > 0 then
    raise exception 'Quedaron % mensajes en la cuenta equivocada.', v_quedan;
  end if;

  raise notice 'Mensajes devueltos a su cuenta: %', v_movidos;
end
$rep$;

-- ---------------------------------------------------------------------
-- 3. La identidad correcta.
-- ---------------------------------------------------------------------
create unique index conversations_cuenta_externo
  on conversations (account_id, external_id);

comment on index conversations_cuenta_externo is
  'Identidad de una conversación: el número del negocio (account_id) más el '
  'JID de la persona. NUNCA (provider, external_id): external_id es el JID '
  'de quien escribe, así que sin la cuenta la misma persona colisiona entre '
  'clientes distintos de la plataforma.';

-- ---------------------------------------------------------------------
-- 4. Que no se pueda volver a escribir mal.
--
-- Tres llaves compuestas. Postgres las necesita apuntando a un índice único
-- que incluya las dos columnas; sobre una PK más el tenant es trivial.
-- ---------------------------------------------------------------------
create unique index if not exists channel_accounts_id_tenant
  on channel_accounts (id, tenant_id);
create unique index if not exists conversations_id_tenant
  on conversations (id, tenant_id);
create unique index if not exists contacts_id_tenant
  on contacts (id, tenant_id);

-- Un mensaje no puede estar en la conversación de otra cuenta. ESTA es la
-- que habría hecho ruido el 31/08 en vez de tragarse cinco mensajes.
alter table messages
  add constraint messages_conversacion_del_tenant
  foreign key (conversation_id, tenant_id)
  references conversations (id, tenant_id) on delete cascade;

-- Una conversación no puede colgar del número de otra cuenta.
alter table conversations
  add constraint conversations_cuenta_del_tenant
  foreign key (account_id, tenant_id)
  references channel_accounts (id, tenant_id) on delete cascade;

-- Ni tener la ficha de una persona de otra cuenta. `contact_id` es
-- nullable: con MATCH SIMPLE, una fila sin contacto no se valida, que es lo
-- que queremos (los grupos no tienen). El `set null` va con lista de
-- columnas —Postgres 15+— porque `tenant_id` es not null y sin la lista
-- intentaría anular las dos.
alter table conversations
  add constraint conversations_contacto_del_tenant
  foreign key (contact_id, tenant_id)
  references contacts (id, tenant_id) on delete set null (contact_id);

comment on constraint messages_conversacion_del_tenant on messages is
  'Un mensaje vive en una conversación de SU cuenta. Sin esto, un upsert '
  'que resuelve mal la conversación guarda el mensaje donde nadie lo ve y '
  'no falla nada.';
