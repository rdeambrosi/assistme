import type { Channel as DbChannel } from "@/lib/db/types";

export type UiChannel = "gmail" | "telegram" | "whatsapp";

export interface HistoryEntry {
  when: string;
  text: string;
}

export interface QueueItem {
  id: number;
  channel: UiChannel;
  name: string;
  wait: string;
  meetingIntent: boolean;
  snippet: string;
  original: string;
  draft: string;
  contactSub: string;
  history: HistoryEntry[];
}

export interface Contact {
  id: number;
  name: string;
  sub: string;
  channels: UiChannel[];
  notes: string;
}

export const queueData: QueueItem[] = [
  {
    id: 1,
    channel: "gmail",
    name: "Martin Alsogaray",
    wait: "3h",
    meetingIntent: false,
    snippet:
      "Che, te queria consultar sobre el capital call de la serie A, cuando...",
    original:
      "Che, te queria consultar sobre el capital call de la serie A, cuando estaria cerrando eso? Nos gustaria tener claridad para el reporte del LP.",
    draft:
      "Hola Martin, el capital call cierra el 5/9. Te mando el detalle armado para el reporte del LP esta semana. Cualquier cosa lo vemos por acá.",
    contactSub: "LP · Fondo Andes Capital",
    history: [
      { when: "hace 2 dias", text: "Confirmo transferencia de USD 250k recibida." },
      { when: "hace 1 semana", text: "Pregunta sobre términos del SAFE." },
    ],
  },
  {
    id: 2,
    channel: "telegram",
    name: "Grupo Twin Dev",
    wait: "45m",
    meetingIntent: false,
    snippet: "el deploy de staging quedo colgado, alguien lo puede revisar...",
    original:
      "el deploy de staging quedo colgado, alguien lo puede revisar? el build de vercel tira timeout en el step de migrations",
    draft:
      "Miro el log del build ahora. Si es timeout de migrations probablemente sea el lock de la tabla grande, lo desbloqueo manual y reintento.",
    contactSub: "Grupo interno · 6 miembros",
    history: [
      { when: "hoy 11:20", text: "Deploy anterior OK, sin incidentes." },
      { when: "ayer", text: "Discusión sobre migración de schema." },
    ],
  },
  {
    id: 3,
    channel: "whatsapp",
    name: "Sofia (Belo)",
    wait: "6h",
    meetingIntent: true,
    snippet: "Rafa como andas! te escribo por lo del webinar de fintech...",
    original:
      "Rafa como andas! te escribo por lo del webinar de fintech del mes que viene, contamos con vos para el panel? seria el 18/9 a la tarde",
    draft:
      "Hola Sofia! Si, cuenten conmigo para el panel. El 18/9 a la tarde me queda bien, cualquier horario entre 15 y 19hs funciona.",
    contactSub: "Ex colega · Belo",
    history: [
      { when: "hace 3 semanas", text: "Coordinación de entrega de accesos post salida." },
    ],
  },
  {
    id: 4,
    channel: "gmail",
    name: "Juliana Weiss (CFA)",
    wait: "1d",
    meetingIntent: false,
    snippet: "Confirmando el horario del mock exam del sabado...",
    original:
      "Confirmando el horario del mock exam del sabado, quedamos 10am o lo movemos a la tarde? avisame para reservar la sala de estudio.",
    draft: "Confirmo 10am, me viene bien. Reservá la sala, ahí estoy.",
    contactSub: "Grupo de estudio · CFA L3",
    history: [{ when: "hace 4 dias", text: "Compartió resumen de fixed income." }],
  },
  {
    id: 5,
    channel: "whatsapp",
    name: "Diego (Fluxis)",
    wait: "20m",
    meetingIntent: true,
    snippet:
      "necesitamos definir el flujo de liquidacion con el merchant piloto...",
    original:
      "necesitamos definir el flujo de liquidacion con el merchant piloto antes del viernes, tenes 20 min hoy para verlo?",
    draft:
      "Dale, tengo lugar hoy a las 17hs. Te mando invite con Meet para repasar el flujo de liquidación.",
    contactSub: "Co-founder · Fluxis",
    history: [
      { when: "ayer", text: "Definieron el fee del merchant piloto." },
      { when: "hace 5 dias", text: "Revisión de contrato de interoperabilidad." },
    ],
  },
];

// Notas de contexto persistentes por contacto — se inyectan en cada prompt de
// draft junto con el historial recuperado por RAG. Front-end de contacts.context_notes.
export const contactsData: Contact[] = [
  {
    id: 1,
    name: "Martin Alsogaray",
    sub: "LP · Fondo Andes Capital",
    channels: ["gmail"],
    notes:
      "Habla formal, es inversor institucional. Confirmar siempre montos en USD de forma explicita. No tutear.",
  },
  {
    id: 2,
    name: "Grupo Twin Dev",
    sub: "Grupo interno · 6 miembros",
    channels: ["telegram"],
    notes: "Equipo interno, tono directo y tecnico. No hace falta formalidad ni contexto de negocio.",
  },
  {
    id: 3,
    name: "Sofia (Belo)",
    sub: "Ex colega · Belo",
    channels: ["whatsapp"],
    notes: "Ex colega, buena relacion, tono cercano e informal. Tutear.",
  },
  {
    id: 4,
    name: "Juliana Weiss (CFA)",
    sub: "Grupo de estudio · CFA L3",
    channels: ["gmail"],
    notes: "Grupo de estudio CFA, respuestas breves y directas, sin formalismos.",
  },
  {
    id: 5,
    name: "Diego (Fluxis)",
    sub: "Co-founder · Fluxis",
    channels: ["whatsapp"],
    notes: "Co-founder de Fluxis. Puede hablar indistintamente de negocio y de temas tecnicos.",
  },
];

export interface SkillOption {
  id: string;
  label: string;
}

export const skillGroups: Record<
  "tono" | "contexto" | "formato",
  { multi: boolean; options: SkillOption[] }
> = {
  tono: {
    multi: false,
    options: [
      { id: "informal", label: "Informal (amigos)" },
      { id: "belo", label: "Trabajo — Belo" },
      { id: "twin", label: "Trabajo — Twin" },
      { id: "externoA", label: "Proyecto externo A" },
    ],
  },
  contexto: {
    multi: true,
    options: [
      { id: "doc-belo", label: "Doc tecnica de Belo" },
      { id: "doc-xyz", label: "Doc tecnica de XYZ" },
      { id: "proyecto-efg", label: "Proyecto EFG" },
    ],
  },
  formato: {
    multi: false,
    options: [
      { id: "action", label: "Action-oriented" },
      { id: "info", label: "Informativo" },
    ],
  },
};

export const channelLabel: Record<UiChannel, string> = {
  gmail: "Gmail",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

// Referencia con los Channel reales de Supabase (gmail_1/2/3, telegram, whatsapp)
// para cuando se conecte esto a datos reales en vez del mock.
export type _DbChannelRef = DbChannel;
