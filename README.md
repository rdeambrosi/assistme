# comms-hub

Agregador de comunicaciones (Gmail x3, Telegram, WhatsApp) con drafts generados
por Claude, revisión humana, y creación de eventos de Google Calendar.
Stack: Next.js (App Router) + TypeScript + Supabase, deploy en Vercel.

## Qué hay en este repo

```
comms-hub/
├── app/
│   ├── layout.tsx                       # fuentes (IBM Plex Mono + Inter) y metadata
│   ├── page.tsx                         # monta <DashboardApp /> (force-dynamic: el login depende de la cookie por request)
│   ├── globals.css                      # design tokens + estilos del blotter
│   ├── login/page.tsx                   # login con password unica
│   └── api/
│       ├── sync/route.ts                # dispara Gmail + Telegram (cron diario + trigger manual)
│       ├── draft/route.ts               # genera drafts con Claude para mensajes pending, en tandas
│       ├── queue/route.ts               # cola de revision para el dashboard (mensajes + contacto + historial)
│       ├── skills/, contacts/           # catalogos para la UI
│       ├── messages/[id]/{status,regenerate,create-meeting}/route.ts
│       ├── webhooks/whatsapp/route.ts   # Meta empuja mensajes acá
│       └── login/route.ts
├── components/
│   ├── DashboardApp.tsx                 # cola + draft + contexto + vista de contactos (fetchea /api/*)
│   └── icons.tsx
├── lib/
│   ├── connectors/{gmail,telegram,calendar}.ts
│   ├── ai/{draft,embeddings,skills}.ts  # ensamblador de prompt + Claude + Voyage (RAG)
│   ├── db/{types,client}.ts             # tipos + cliente Supabase
│   ├── auth.ts                          # hashing compartido por proxy.ts y /api/login
│   └── channels.ts, api-error.ts
├── proxy.ts                             # gate de contraseña para todo el dashboard (Next.js 16 "proxy", ex-middleware)
├── scripts/{gmail,telegram,calendar}-auth.ts  # generan los refresh tokens/session strings, corridas locales una vez
├── skills/{tono,contexto,formato}/*.md  # contenido de las skills seleccionables en la UI (placeholders, editar)
└── supabase/migrations/0001_init.sql    # schema completo
```

## Falta armar

- [ ] Capa de voz (STT/TTS) para "Responder con audio"
- [ ] Enviar de verdad el mensaje al aprobar (hoy "Aprobar" solo cambia el status en Supabase, no dispara el envío por Gmail/Telegram/WhatsApp)
- [ ] Contenido real en `skills/*.md` (hoy son placeholders)

## Setup

1. Creá un proyecto en [supabase.com](https://supabase.com) y corré
   `supabase/migrations/0001_init.sql` (SQL Editor del dashboard)
2. Variables de entorno (Vercel → Project Settings → Environment Variables;
   nunca committear):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=                    # embeddings para el RAG del draft
DASHBOARD_PASSWORD=                # protege TODO el dashboard — sin esto, la URL de Vercel queda publica
CRON_SECRET=                       # valida las corridas automaticas de /api/sync y /api/draft

GOOGLE_CLIENT_ID=                  # OAuth client compartido por Gmail y Calendar (my.google.cloud console)
GOOGLE_CLIENT_SECRET=
GMAIL_1_REFRESH_TOKEN=             # uno por cuenta, generados con `npm run gmail:auth <label>`
GMAIL_2_REFRESH_TOKEN=
GMAIL_3_REFRESH_TOKEN=
GOOGLE_CALENDAR_REFRESH_TOKEN=     # generado con `npm run calendar:auth`, mismo client que Gmail

TELEGRAM_API_ID=                   # my.telegram.org
TELEGRAM_API_HASH=
TELEGRAM_SESSION_STRING=           # generado con `npm run telegram:auth`

WHATSAPP_WEBHOOK_VERIFY_TOKEN=     # el que configures en Meta App Dashboard
WHATSAPP_BUSINESS_TOKEN=           # para enviar mensajes (todavia no implementado)
```

3. Local: `vercel link` (una vez) → `vercel env pull .env.local` → `npm install && npm run dev`
4. Los scripts de auth (`gmail:auth`, `telegram:auth`, `calendar:auth`) se
   corren una sola vez cada uno, local, interactivos — abren el navegador o
   piden datos por consola y al final imprimen el token/session para pegar
   en Vercel.
5. Deploy: `vercel --prod` (el proyecto en Vercel tiene que tener Framework
   Preset = Next.js en Settings → Build and Deployment).

## Notas de diseño

- `context_chunks.embedding` es `vector(1024)`, asumiendo embeddings de
  Voyage AI (`voyage-3`). Si usás OpenAI (`text-embedding-3-small`), cambiá
  la dimensión a `vector(1536)` **antes** de cargar datos.
- `messages` tiene `unique(channel, external_id)` + upsert idempotente —
  correr el sync dos veces no duplica mensajes.
- `message_skills` persiste qué tono/contexto/formato se tildó por mensaje
  en la UI — sin esto la selección se pierde al refrescar.
- El plan Hobby de Vercel limita los cron jobs a una corrida por día — por
  eso `vercel.json` dispara `/api/sync` y `/api/draft` una vez (`0 9 * * *`
  y `5 9 * * *`). Para sync más seguido hay que pasar a Pro, o disparar
  manual (`curl` / el trigger que corresponda).
