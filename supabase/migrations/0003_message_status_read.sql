-- ---------------------------------------------------------------------------
-- messages.status: agrega 'read' — "lo vi, no hace falta responder" — como
-- estado distinto de 'skipped' ("lo descarto"). Usado por la accion masiva
-- "Marcar leido" de la cola de revision.
-- ---------------------------------------------------------------------------
alter table messages drop constraint if exists messages_status_check;
alter table messages add constraint messages_status_check
  check (status in ('pending','drafted','approved','sent','skipped','read'));
