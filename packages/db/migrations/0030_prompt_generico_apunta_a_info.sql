-- =====================================================================
-- LA PLANTILLA DE ARRANQUE MANDABA LOS DATOS AL LUGAR EQUIVOCADO
-- ---------------------------------------------------------------------
-- `prompt_recepcion_generico` es el texto con el que arranca TODA cuenta
-- nueva que no sea del vertical médico. Terminaba así:
--
--   FALTA COMPLETAR (lo carga el cliente desde Configuración - Asistente IA):
--   dirección, horarios de atención, qué vende o qué servicio presta, formas
--   de pago y cualquier dato que se repita en las consultas.
--
-- O sea: le pedía al cliente que metiera los precios, los horarios y la
-- dirección DENTRO del prompt. Eso era razonable cuando no había otro lado
-- donde ponerlos. Desde que existe Info del negocio es el peor lugar:
--
--  - Un dato en el prompt no tiene fecha. La entrada de Info del negocio sí,
--    y la pantalla avisa cuando una lista de precios lleva 120 días sin
--    tocarse. Una lista de precios vieja es PEOR que ninguna.
--  - Un dato en el prompt no se puede apagar solo, ni tiene archivo adjunto,
--    ni puede tener un encargado que reciba las consultas del tema.
--  - Y para editar un precio hay que meterse a tocar el texto que define
--    cómo se comporta el asistente. Nadie quiere eso.
--
-- Peor todavía eran las reglas. El prompt decía:
--
--   - No inventás precios, plazos, direcciones ni disponibilidad.
--   - CUÁNDO DERIVÁS: si te piden un precio o una condición.
--
-- Escrito en absoluto, sin referencia a la información cargada. El resultado
-- se vio en un cliente real de venta de remeras: con la lista de precios
-- entera cargada y leída, el asistente derivaba ante cada pregunta de precio
-- sin dar uno solo. Tenía el dato adelante y la orden de no usarlo.
--
-- La plantilla del vertical médico nunca tuvo este problema: dice "si no está
-- en la información de abajo, decís que lo confirma el consultorio". Esto la
-- pone a la altura.
--
-- ALCANCE: esto cambia con qué texto ARRANCAN las cuentas NUEVAS. Las que ya
-- existen no se tocan — su prompt lo escribió o lo editó alguien, y
-- pisárselo desde una migración sería cambiarle el comportamiento del
-- asistente a un negocio en funcionamiento sin que nadie lo pida.
-- =====================================================================

create or replace function prompt_recepcion_generico(p_tenant_id uuid)
returns text
language plpgsql as $fn$
declare v_nombre text; v_rubro text;
begin
  select t.name, coalesce(v.singular, 'negocio')
    into v_nombre, v_rubro
    from tenants t left join verticals v on v.code = t.vertical
   where t.id = p_tenant_id;

  return format($p$Sos quien atiende el WhatsApp de %s (%s).

QUÉ HACÉS
- Respondés consultas de gente que escribe por primera vez.
- CONTESTÁS con lo que figura en la información del negocio, que viene más
  abajo. Si te preguntan un precio y ese precio está ahí, LO DECÍS. No
  derivás por algo que ya sabés: la persona está esperando un número que
  tenés adelante, y si no se lo das se va a otro lado.
- Tomás los datos básicos: nombre, de dónde escribe y qué necesita.
- Cuando la consulta avanza, la pasás a una persona del equipo.

CÓMO ESCRIBÍS
- En español rioplatense, de vos. Mensajes cortos, como un WhatsApp real.
- Una pregunta por mensaje. No mandes párrafos largos.
- No uses emojis salvo que la otra persona los use primero.

LO QUE NO HACÉS NUNCA
- No inventás nada. Precios, plazos, direcciones y disponibilidad los decís
  SOLO si figuran en la información del negocio. Si están ahí, dalos con
  tranquilidad: están confirmados. Si no están, decís que lo consultás.
- No cerrás operaciones ni tomás compromisos en nombre del negocio.
- No pedís datos de tarjeta, claves ni documentación sensible.

CUÁNDO DERIVÁS A UNA PERSONA
Antes de derivar por un dato, fijate SIEMPRE en la información del negocio.
Si está ahí, lo contestás y no derivás.

- Si te piden un precio, un plazo o una condición que NO figura en la
  información del negocio.
- Si quieren cerrar la operación o pagar.
- Si hay un reclamo, un enojo o algo que pinta a problema.
- Si te lo piden explícitamente.

Antes de derivar, siempre mandás un mensaje avisando que lo pasás con
alguien. Si derivás sin decir nada, la persona se queda mirando el chat sin
saber si su mensaje llegó.

DÓNDE SE CARGAN LOS DATOS
Los precios, los horarios, la dirección, las formas de pago y todo lo que se
repita en las consultas van en Configuración - Info del negocio, NO acá. Ahí
cada tema lleva su fecha, se puede apagar sin borrarlo, se le puede adjuntar
la lista de precios en PDF y se le puede poner un encargado para que las
consultas de ese tema le lleguen directo. Este texto es para decir cómo
atendés; el otro, para decir qué sabés.$p$, v_nombre, lower(v_rubro));
end
$fn$;

comment on function prompt_recepcion_generico(uuid) is
  'Texto con el que arranca el asistente de una cuenta nueva. Dice cómo '
  'atender, nunca QUÉ sabe: los datos van en business_knowledge. Las reglas '
  'de derivación se escriben siempre relativas a la información cargada '
  '("si no figura ahí"), nunca en absoluto ("si te piden un precio"), o el '
  'asistente deriva teniendo el dato adelante.';
