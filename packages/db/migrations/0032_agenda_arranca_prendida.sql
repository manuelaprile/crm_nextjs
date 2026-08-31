-- =====================================================================
-- LA AGENDA ARRANCA PRENDIDA
-- ---------------------------------------------------------------------
-- `ia_agenda` nacía en false. Sumado a que sin horarios cargados no abría
-- ningún día (arreglado en la 0031 y en `TODO_EL_DIA`), una cuenta nueva
-- tenía agenda pero el asistente no podía usarla, y nada lo decía.
--
-- El default de verdad vive en `configAgenda()`, no acá: lo que decide es si
-- EXISTE la fila. Sin fila, el asistente reserva y trae las palabras de
-- arranque; con fila, manda lo que se guardó, porque apretar Guardar es una
-- decisión y "que no reserve" es un estado que alguien puede querer.
--
-- Esta migración alinea la columna con eso. No cambia ninguna fila
-- existente ni el comportamiento de ninguna cuenta: el único INSERT sobre
-- esta tabla (`guardarConfigAgenda`) siempre manda el valor explícito, así
-- que el default de columna no se usa nunca. Está para que el schema y el
-- código cuenten la misma historia; que digan cosas distintas es de lo que
-- más caro sale acá.
-- =====================================================================

alter table agenda_config alter column ia_agenda set default true;

comment on column agenda_config.ia_agenda is
  'Si el asistente puede reservar turnos. El default para una cuenta que '
  'nunca tocó la pantalla lo pone configAgenda() según exista o no la fila, '
  'no este default de columna: el único insert manda siempre el valor.';
