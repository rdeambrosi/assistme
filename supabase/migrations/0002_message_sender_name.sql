-- ---------------------------------------------------------------------------
-- messages.sender_name — quien escribio el mensaje dentro de un chat/grupo,
-- distinto de contact_id (que identifica el chat/grupo entero, no la persona
-- puntual). Sin esto, al agrupar la cola de revision por contacto no se podia
-- distinguir quien de un grupo mando cada mensaje.
-- ---------------------------------------------------------------------------
alter table messages add column sender_name text;
