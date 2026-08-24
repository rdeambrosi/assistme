// packages/db/types.ts
// Tipos manuales alineados a supabase/migrations/0001_init.sql.
// Si preferis tipos autogenerados: `supabase gen types typescript --local`
// pero estos alcanzan y son mas legibles para el tamaño de este proyecto.

export type Channel = 'gmail_1' | 'gmail_2' | 'gmail_3' | 'telegram' | 'whatsapp';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'pending' | 'drafted' | 'approved' | 'sent' | 'skipped';
export type SkillGroup = 'tono' | 'contexto' | 'formato';
export type SyncStatus = 'ok' | 'error';

export interface ContactChannelRef {
  channel: Channel;
  address?: string;   // Gmail: email address
  chat_id?: number;    // Telegram/WhatsApp: id externo
}

export interface Contact {
  id: string;
  name: string;
  channels: ContactChannelRef[];
  context_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncState {
  channel: Channel;
  last_cursor: string | null;
  last_run_at: string | null;
  last_status: SyncStatus;
  last_error: string | null;
  updated_at: string;
}

export interface TelegramChatCursor {
  chat_id: number;
  last_message_id: number | null;
  updated_at: string;
}

export interface Skill {
  id: string;               // ej: 'tono:belo'
  group_name: SkillGroup;
  label: string;
  file_path: string;
  created_at: string;
}

export interface Message {
  id: string;
  channel: Channel;
  contact_id: string | null;
  thread_id: string | null;
  external_id: string | null;
  direction: MessageDirection;
  content: string;
  received_at: string;
  status: MessageStatus;
  draft_content: string | null;
  meeting_intent: boolean;
  suggested_meeting_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageSkill {
  message_id: string;
  skill_id: string;
}

export interface ContextChunk {
  id: string;
  contact_id: string | null;
  channel: Channel | null;
  content: string;
  embedding: number[]; // vector(1024)
  created_at: string;
}

// Selecciones de skills tal como las maneja la UI (ver comms-hub-dashboard-v4.html):
// tono y formato son single-select, contexto es multi-select.
export interface SkillSelection {
  tono: string | null;
  contexto: string[];
  formato: string | null;
}

// Lo que devuelve Claude al generar un draft — separa el texto de la
// deteccion de intencion de reunion para que el frontend renderice
// la sugerencia sin tener que parsear el texto libre.
export interface DraftResult {
  draft: string;
  meeting_intent: boolean;
  suggested_meeting_at: string | null;
}
