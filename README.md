# comms-hub

Agregador de comunicaciones (Gmail x3, Telegram, WhatsApp) con drafts generados
por Claude, revisión humana, y creación de eventos de Google Calendar.
Stack: Next.js (App Router) + TypeScript + Supabase, deploy en Vercel.

## Qué hay en este repo por ahora

Proyecto Next.js (App Router) con el dashboard de la cola de revisión ya
portado del mockup de diseño (datos mock, sin conectores reales todavía):

```
comms-hub/
├── app/
│   ├── layout.tsx              # fuentes (IBM Plex Mono + Inter) y metadata
│   ├── page.tsx                # monta <DashboardApp />
│   └── globals.css             # design tokens + estilos del blotter
├── components/
│   ├── DashboardApp.tsx        # cola + draft + contexto + vista de contactos
│   └── icons.tsx
├── lib/
│   ├── mock-data.ts            # datos de ejemplo (cola, contactos, skills)
│   └── db/
│       ├── types.ts             # tipos TypeScript alineados al schema
│       └── client.ts            # cliente Supabase + queries tipadas
└── supabase/
    └── migrations/
        └── 0001_init.sql       # schema completo: messages, contacts, sync_state,
                                  # telegram_chat_cursors, skills, message_skills,
                                  # context_chunks (pgvector para RAG)
```

Next.js simple, sin monorepo — `lib/db` reemplaza lo que antes era
`packages/db`.

## Falta armar

- [ ] Conectar el dashboard a datos reales de Supabase (reemplazar `lib/mock-data.ts`)
- [ ] Conectores: `lib/connectors/{gmail,telegram,whatsapp}`
- [ ] Ensamblador de prompt + llamada a Claude API (structured output)
- [ ] Cron de Vercel (`vercel.json`) + endpoint `/api/sync`
- [ ] Webhook de WhatsApp Business API
- [ ] Integración de Google Calendar (creación de eventos + Meet)
- [ ] Capa de voz (STT/TTS) para "Responder con audio"

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

4. `npm install && npm run dev` para levantar el dashboard en `localhost:3000`
   (por ahora corre 100% con `lib/mock-data.ts`, no necesita las env vars de
   arriba para el modo desarrollo visual).

## Notas de diseño

- `context_chunks.embedding` es `vector(1024)`, asumiendo embeddings de
  Voyage AI (`voyage-3`). Si usás OpenAI (`text-embedding-3-small`), cambiá
  la dimensión a `vector(1536)` **antes** de cargar datos.
- `messages` tiene `unique(channel, external_id)` + upsert idempotente — 
  correr el sync dos veces no duplica mensajes.
- `message_skills` persiste qué tono/contexto/formato se tildó por mensaje
  en la UI — sin esto la selección se pierde al refrescar.
