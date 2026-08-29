-- ---------------------------------------------------------------------
-- Ponerle al contacto el responsable que ya tenía su conversación.
--
-- El responsable del contacto y el de su conversación se sincronizan en los
-- dos sentidos desde el commit anterior, pero eso vale de ahí en adelante.
-- Todo lo que se derivó ANTES quedó a medias: la conversación con su dueño y
-- el contacto sin ninguno, y la tarjeta del tablero decía "Sin asignar" para
-- alguien que sí estaba atendido. Esta migración empareja lo viejo.
--
-- Solo toca contactos que HOY no tienen responsable: si alguien ya se lo
-- puso a mano, esa decisión gana.
-- ---------------------------------------------------------------------

update contacts c
   set owner_user_id = elegido.assigned_user_id
  from (
    -- Si un contacto tiene varias conversaciones asignadas, gana la del
    -- último mensaje: es la que alguien está atendiendo ahora.
    select distinct on (v.contact_id)
           v.contact_id, v.assigned_user_id
      from conversations v
     where v.assigned_user_id is not null
       and v.contact_id is not null
       and v.archived_at is null
     order by v.contact_id, v.last_message_at desc nulls last
  ) as elegido
 where c.id = elegido.contact_id
   and c.owner_user_id is null;
