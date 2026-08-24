# comms-hub

Agregador de comunicaciones (Gmail x3, Telegram, WhatsApp) con drafts generados
por Claude, revisión humana, y creación de eventos de Google Calendar.
Stack: Next.js (App Router) + TypeScript + Supabase, deploy en Vercel.

## Qué hay en este repo por ahora

Esto es un scaffold parcial — todavía no es un proyecto Next.js corriendo,
es la base de datos + los tipos ya definidos:

```
comms-hub/
├── supabase/
│   └── migrations/
│       └── 0001_init.sql      # schema completo: messages, contacts, sync_state,
│                               # telegram_chat_cursors, skills, message_skills,
│                               # context_chunks (pgvector para RAG)
└── packages/
    └── db/
        ├── types.ts            # tipos TypeScript alineados al schema
        ├── client.ts           # cliente Supabase + queries tipadas
        └── package.json
```

## Falta armar

- [ ] Scaffold de Next.js (`apps/web`) — dashboard de revisión + API routes
- [ ] Conectores: `packages/connectors/{gmail,telegram,whatsapp}`
- [ ] Ensamblador de prompt + llamada a Claude API (structured output)
- [ ] Cron de Vercel (`vercel.json`) + endpoint `/api/sync`
- [ ] Webhook de WhatsApp Business API
- [ ] Integración de Google Calendar (creación de eventos + Meet)

## Setup

1. Creá un proyecto en [supabase.com](https://supabase.com)
2. Corré `supabase/migrations/0001_init.sql` contra ese proyecto (SQL Editor
   del dashboard, o `supabase db push` si usás la CLI)
3. Variables de entorno necesarias (nunca committear, van en `.env.local` o en
   Vercel → Project Settings → Environment Variables):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
```

4. `packages/db` asume un monorepo tipo Turborepo. Si arrancás con un Next.js
   simple, movés `types.ts` y `client.ts` a `apps/web/lib/db/` y ajustás los
   imports relativos — no hace falta decidir la estructura de monorepo hoy.

## Notas de diseño

- `context_chunks.embedding` es `vector(1024)`, asumiendo embeddings de
  Voyage AI (`voyage-3`). Si usás OpenAI (`text-embedding-3-small`), cambiá
  la dimensión a `vector(1536)` **antes** de cargar datos.
- `messages` tiene `unique(channel, external_id)` + upsert idempotente — 
  correr el sync dos veces no duplica mensajes.
- `message_skills` persiste qué tono/contexto/formato se tildó por mensaje
  en la UI — sin esto la selección se pierde al refrescar.
