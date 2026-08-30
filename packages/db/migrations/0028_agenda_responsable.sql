-- =====================================================================
-- EL TURNO TIENE UN RESPONSABLE
-- ---------------------------------------------------------------------
-- Hasta acá un turno decía QUIÉN LO CARGÓ (`creado_por`) pero no a quién le
-- toca atenderlo. No son lo mismo: el dueño carga un turno para su
-- vendedora, y la IA carga turnos sin usuario ninguno. Sin esta columna, la
-- agenda no se puede recortar por persona y todos ven todo.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, a propósito: no toca
-- `appointments_sin_superposicion`. La agenda sigue siendo UNA del negocio y
-- dos turnos no se pisan, sea de quien sea. El responsable dice quién atiende,
-- no abre una agenda paralela por persona: el recurso escaso sigue siendo el
-- negocio —el consultorio, la sala, el auto— y no la persona.
--
-- Es aditiva: la columna es nullable y nada la exige. El código viejo sigue
-- funcionando con ella puesta, que es lo que hace que se pueda volver atrás.
-- =====================================================================

alter table appointments
  add column if not exists assigned_user_id uuid references users(id) on delete set null;

comment on column appointments.assigned_user_id is
  'A quién le toca atender este turno. Distinto de creado_por, que es quién '
  'lo cargó. Puede ser null: un turno que puso la IA para un contacto que '
  'todavía no tomó nadie no es de nadie, y eso es un dato, no un error.';

-- La agenda de una persona en una ventana de tiempo. Es la consulta que hace
-- la pantalla en cada carga para un operador.
create index if not exists appointments_responsable
  on appointments (tenant_id, assigned_user_id, starts_at)
  where assigned_user_id is not null;

-- ---------------------------------------------------------------------
-- Los turnos que ya existen: el responsable sale del dueño del contacto.
--
-- Es la misma respuesta que da el sistema de ahora en adelante cuando la IA
-- agenda, así que lo viejo y lo nuevo quedan contando la misma historia. Sin
-- esto, el día que se prende el recorte por rol la agenda de cada operador
-- aparece vacía y parece que se perdieron los turnos.
--
-- Cuando el turno no tiene contacto —una reunión con un proveedor, un
-- bloqueo de agenda— se cae en quien lo cargó, que es lo más cercano a un
-- responsable que hay. Los que no tienen ninguna de las dos cosas quedan en
-- null y los ve solo el dueño: no hay a quién atribuírselos.
-- ---------------------------------------------------------------------
update appointments a
   set assigned_user_id = coalesce(c.owner_user_id, a.creado_por)
  from contacts c
 where c.id = a.contact_id
   and a.assigned_user_id is null
   and coalesce(c.owner_user_id, a.creado_por) is not null;

update appointments
   set assigned_user_id = creado_por
 where assigned_user_id is null
   and contact_id is null
   and creado_por is not null;
