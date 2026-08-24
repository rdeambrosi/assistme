-- Comms Hub — schema inicial
-- Requiere la extension pgvector (Supabase la trae disponible, solo hay que habilitarla)
create extension if not exists vector;
create extension if not exists pgcrypto; -- para gen_random_uuid()

-- ---------------------------------------------------------------------------
-- updated_at automatico en cada UPDATE
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- contacts — un interlocutor, independiente del canal por el que escribe
-- ---------------------------------------------------------------------------
create table contacts (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  -- ej: [{"channel":"gmail","address":"x@y.com"},{"channel":"telegram","chat_id":123456}]
  channels       jsonb not null default '[]'::jsonb,
  -- nota persistente y estatica (tono, rol, reglas de trato). Se inyecta entera
  -- en cada prompt para este contacto, sin busqueda vectorial de por medio.
  context_notes  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- sync_state — cursor de sincronizacion por canal (uno por cuenta de Gmail)
-- ---------------------------------------------------------------------------
create table sync_state (
  channel        text primary key,   -- 'gmail_1' | 'gmail_2' | 'gmail_3' | 'telegram' | 'whatsapp'
  last_cursor    text,               -- historyId (Gmail); null para telegram/whatsapp (ver detalle abajo)
  last_run_at    timestamptz,
  last_status    text not null default 'ok' check (last_status in ('ok', 'error')),
  last_error     text,
  updated_at     timestamptz not null default now()
);

create trigger sync_state_set_updated_at
  before update on sync_state
  for each row execute function set_updated_at();

insert into sync_state (channel) values
  ('gmail_1'), ('gmail_2'), ('gmail_3'), ('telegram'), ('whatsapp');

-- ---------------------------------------------------------------------------
-- telegram_chat_cursors — Telegram tiene multiples chats, cada uno con su
-- propio cursor de "ultimo message_id procesado". sync_state.telegram solo
-- trackea last_run_at general; el cursor real vive aca.
-- ---------------------------------------------------------------------------
create table telegram_chat_cursors (
  chat_id          bigint primary key,
  last_message_id  bigint,
  updated_at       timestamptz not null default now()
);

create trigger telegram_chat_cursors_set_updated_at
  before update on telegram_chat_cursors
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- skills — catalogo de los .md de tono / contexto / formato seleccionables
-- desde el dropdown de la UI. group_name define si es single o multi-select
-- en el frontend (tono y formato: single: contexto: multi).
-- ---------------------------------------------------------------------------
create table skills (
  id          text primary key,      -- ej: 'tono:belo', 'contexto:doc-belo', 'formato:action'
  group_name  text not null check (group_name in ('tono', 'contexto', 'formato')),
  label       text not null,         -- ej: 'Trabajo — Belo'
  file_path   text not null,         -- ej: 'skills/tono/belo.md'
  created_at  timestamptz not null default now()
);

insert into skills (id, group_name, label, file_path) values
  ('tono:informal',  'tono',     'Informal (amigos)',        'skills/tono/informal.md'),
  ('tono:belo',      'tono',     'Trabajo — Belo',            'skills/tono/belo.md'),
  ('tono:twin',      'tono',     'Trabajo — Twin',            'skills/tono/twin.md'),
  ('tono:externoA',  'tono',     'Proyecto externo A',        'skills/tono/externo-a.md'),
  ('contexto:doc-belo',    'contexto', 'Doc tecnica de Belo', 'skills/contexto/doc-belo.md'),
  ('contexto:doc-xyz',     'contexto', 'Doc tecnica de XYZ',  'skills/contexto/doc-xyz.md'),
  ('contexto:proyecto-efg','contexto', 'Proyecto EFG',        'skills/contexto/proyecto-efg.md'),
  ('formato:action', 'formato',  'Action-oriented',           'skills/formato/action.md'),
  ('formato:info',   'formato',  'Informativo',               'skills/formato/informativo.md');

-- ---------------------------------------------------------------------------
-- messages — nucleo del sistema. Todo canal converge a este mismo esquema.
-- ---------------------------------------------------------------------------
create table messages (
  id                    uuid primary key default gen_random_uuid(),
  channel               text not null check (channel in ('gmail_1','gmail_2','gmail_3','telegram','whatsapp')),
  contact_id            uuid references contacts(id),
  thread_id             text,               -- id de hilo/chat en el sistema origen
  external_id           text,               -- id del mensaje en el sistema origen
  direction             text not null check (direction in ('inbound','outbound')),
  content               text not null,
  received_at           timestamptz not null default now(),
  status                text not null default 'pending'
                        check (status in ('pending','drafted','approved','sent','skipped')),
  draft_content         text,
  -- salida estructurada de Claude, no algo que el usuario setea a mano
  meeting_intent        boolean not null default false,
  suggested_meeting_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (channel, external_id)
);

create index messages_contact_id_idx on messages (contact_id);
create index messages_channel_status_idx on messages (channel, status);
create index messages_thread_id_idx on messages (thread_id);

create trigger messages_set_updated_at
  before update on messages
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- message_skills — que skills se tildaron para el draft de cada mensaje.
-- Sin esto, la seleccion de la UI se pierde al refrescar.
-- ---------------------------------------------------------------------------
create table message_skills (
  message_id  uuid not null references messages(id) on delete cascade,
  skill_id    text not null references skills(id),
  primary key (message_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- context_chunks — historial vectorizado para RAG (busqueda por contact_id)
-- Dimension 1024 asume embeddings de Voyage AI (voyage-3), la opcion que
-- Anthropic recomienda ya que Claude no tiene endpoint de embeddings propio.
-- Si usas OpenAI text-embedding-3-small, cambia a vector(1536).
-- ---------------------------------------------------------------------------
create table context_chunks (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references contacts(id),
  channel     text,
  content     text not null,
  embedding   vector(1024),
  created_at  timestamptz not null default now()
);

create index context_chunks_contact_id_idx on context_chunks (contact_id);

-- Indice para busqueda por similitud (ivfflat; requiere ANALYZE luego de cargar datos)
create index context_chunks_embedding_idx on context_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------------------------------------------------------------------------
-- match_context_chunks — busqueda por similitud coseno, acotada a un contacto.
-- Se expone como funcion SQL porque el operador `<=>` de pgvector no es
-- expresable directo con el query builder de supabase-js.
-- ---------------------------------------------------------------------------
create or replace function match_context_chunks(
  p_contact_id uuid,
  p_embedding vector(1024),
  p_limit int default 5
)
returns setof context_chunks
language sql stable
as $$
  select *
  from context_chunks
  where contact_id = p_contact_id
  order by embedding <=> p_embedding
  limit p_limit;
$$;

