// packages/db/client.ts
// Cliente tipado + queries reutilizables. Este archivo es el unico lugar
// del repo que le habla directo a Supabase — connectors/ y api routes
// importan de aca, nunca instancian su propio cliente.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Channel,
  Contact,
  ContactChannelRef,
  ContextChunk,
  DraftResult,
  Message,
  MessageStatus,
  Skill,
  SkillSelection,
  SyncState,
  TelegramChatCursor,
} from './types';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-side only, nunca en el cliente
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

// ---------------------------------------------------------------------------
// sync_state
// ---------------------------------------------------------------------------
export async function getSyncState(channel: Channel): Promise<SyncState> {
  const { data, error } = await getSupabase()
    .from('sync_state')
    .select('*')
    .eq('channel', channel)
    .single();
  if (error) throw error;
  return data as SyncState;
}

export async function updateSyncState(
  channel: Channel,
  patch: Partial<Pick<SyncState, 'last_cursor' | 'last_run_at' | 'last_status' | 'last_error'>>
): Promise<void> {
  const { error } = await getSupabase().from('sync_state').update(patch).eq('channel', channel);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// telegram_chat_cursors
// ---------------------------------------------------------------------------
export async function getTelegramCursor(chatId: number): Promise<TelegramChatCursor | null> {
  const { data, error } = await getSupabase()
    .from('telegram_chat_cursors')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) throw error;
  return data as TelegramChatCursor | null;
}

export async function upsertTelegramCursor(chatId: number, lastMessageId: number): Promise<void> {
  const { error } = await getSupabase()
    .from('telegram_chat_cursors')
    .upsert({ chat_id: chatId, last_message_id: lastMessageId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// contacts
// ---------------------------------------------------------------------------
export async function getContact(contactId: string): Promise<Contact | null> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .maybeSingle();
  if (error) throw error;
  return data as Contact | null;
}

export async function updateContactNotes(contactId: string, notes: string): Promise<void> {
  const { error } = await getSupabase()
    .from('contacts')
    .update({ context_notes: notes })
    .eq('id', contactId);
  if (error) throw error;
}

// Busca un contacto que ya tenga esta direccion/chat_id registrado en `channels`;
// si no existe, crea uno nuevo con ese canal. Usado por los connectors para
// mapear un mensaje entrante a un contact_id sin duplicar contactos.
export async function findOrCreateContactByChannel(
  ref: ContactChannelRef,
  fallbackName: string
): Promise<Contact> {
  const supabase = getSupabase();
  const matchKey = ref.channel === 'telegram' || ref.channel === 'whatsapp' ? 'chat_id' : 'address';
  const matchValue = ref.channel === 'telegram' || ref.channel === 'whatsapp' ? ref.chat_id : ref.address;

  const { data: existing, error: findErr } = await supabase
    .from('contacts')
    .select('*')
    .contains('channels', [{ channel: ref.channel, [matchKey]: matchValue }]);
  if (findErr) throw findErr;
  if (existing && existing.length > 0) return existing[0] as Contact;

  const { data: created, error: createErr } = await supabase
    .from('contacts')
    .insert({ name: fallbackName, channels: [ref] })
    .select()
    .single();
  if (createErr) throw createErr;
  return created as Contact;
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------
export async function insertRawMessage(msg: {
  channel: Channel;
  contact_id: string | null;
  thread_id: string | null;
  external_id: string | null;
  direction: 'inbound' | 'outbound';
  content: string;
  received_at: string;
}): Promise<Message> {
  // upsert por (channel, external_id) para que re-correr el sync sea idempotente.
  // ignoreDuplicates:false (default) para que siempre devuelva la fila —
  // con true, Postgres no devuelve nada en un conflicto y .single() explota.
  const { data, error } = await getSupabase()
    .from('messages')
    .upsert(msg, { onConflict: 'channel,external_id' })
    .select()
    .single();
  if (error) throw error;
  return data as Message;
}

export async function getPendingMessages(): Promise<Message[]> {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('*')
    .eq('status', 'pending')
    .order('received_at', { ascending: true });
  if (error) throw error;
  return data as Message[];
}

export async function saveDraft(messageId: string, result: DraftResult): Promise<void> {
  const { error } = await getSupabase()
    .from('messages')
    .update({
      status: 'drafted' as MessageStatus,
      draft_content: result.draft,
      meeting_intent: result.meeting_intent,
      suggested_meeting_at: result.suggested_meeting_at,
    })
    .eq('id', messageId);
  if (error) throw error;
}

export async function setMessageStatus(messageId: string, status: MessageStatus): Promise<void> {
  const { error } = await getSupabase().from('messages').update({ status }).eq('id', messageId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// skills / message_skills — persiste lo tildado en el dropdown de la UI
// ---------------------------------------------------------------------------
export async function getAllSkills(): Promise<Skill[]> {
  const { data, error } = await getSupabase().from('skills').select('*');
  if (error) throw error;
  return data as Skill[];
}

export async function saveMessageSkills(messageId: string, selection: SkillSelection): Promise<void> {
  const skillIds = [
    ...(selection.tono ? [selection.tono] : []),
    ...selection.contexto,
    ...(selection.formato ? [selection.formato] : []),
  ];
  const supabase = getSupabase();
  // reemplaza el set completo — mas simple que diffear altas/bajas
  const { error: delErr } = await supabase.from('message_skills').delete().eq('message_id', messageId);
  if (delErr) throw delErr;
  if (skillIds.length === 0) return;
  const { error: insErr } = await supabase
    .from('message_skills')
    .insert(skillIds.map((skill_id) => ({ message_id: messageId, skill_id })));
  if (insErr) throw insErr;
}

// ---------------------------------------------------------------------------
// context_chunks — busqueda vectorial para RAG (requiere el embedding ya calculado)
// ---------------------------------------------------------------------------
export async function searchContextChunks(
  contactId: string,
  embedding: number[],
  limit = 5
): Promise<ContextChunk[]> {
  // match_context_chunks es una funcion SQL (pgvector <-> operator) —
  // se define aparte porque el operador de similitud no es expresable
  // directo con el query builder de supabase-js.
  const { data, error } = await getSupabase().rpc('match_context_chunks', {
    p_contact_id: contactId,
    p_embedding: embedding,
    p_limit: limit,
  });
  if (error) throw error;
  return data as ContextChunk[];
}
