// Conector de Gmail. Trae mensajes nuevos de UNA cuenta ('gmail_1'|'gmail_2'|
// 'gmail_3') usando el patron de cursor: sync_state.last_cursor guarda el
// `historyId` de Gmail. Primera corrida = full sync (sin historyId todavia);
// corridas siguientes = incremental via users.history.list.
//
// Auth: cada cuenta tiene su propio refresh token, generado una vez a mano
// con `npm run gmail:auth <label>` (ver scripts/gmail-auth.ts), guardado como
// GMAIL_1_REFRESH_TOKEN / GMAIL_2_REFRESH_TOKEN / GMAIL_3_REFRESH_TOKEN.

import { google, gmail_v1 } from 'googleapis';
import type { Channel } from '@/lib/db/types';
import { findOrCreateContactByChannel, getSyncState, insertRawMessage, updateSyncState } from '@/lib/db/client';

const GMAIL_CHANNELS = ['gmail_1', 'gmail_2', 'gmail_3'] as const;
export type GmailChannel = (typeof GMAIL_CHANNELS)[number];

export function isGmailChannel(channel: string): channel is GmailChannel {
  return (GMAIL_CHANNELS as readonly string[]).includes(channel);
}

// Cuantos mensajes trae la primera corrida (nunca corrida antes) por cuenta,
// para no importar todo el historico de una.
const INITIAL_SYNC_MAX_RESULTS = 25;

function refreshTokenEnvVar(channel: GmailChannel): string {
  return `${channel.toUpperCase()}_REFRESH_TOKEN`; // GMAIL_1_REFRESH_TOKEN, etc.
}

function gmailClientFor(channel: GmailChannel): gmail_v1.Gmail {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env[refreshTokenEnvVar(channel)];
  if (!clientId || !clientSecret) {
    throw new Error('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el entorno');
  }
  if (!refreshToken) {
    throw new Error(`Falta ${refreshTokenEnvVar(channel)} en el entorno`);
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

function header(msg: gmail_v1.Schema$Message, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

// Extrae el primer bloque text/plain del payload (recorre multipart), o cae
// al snippet de Gmail si no encuentra uno.
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string | null {
  if (!payload) return null;
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const found = extractBody(part);
    if (found) return found;
  }
  return null;
}

// From: "Martin Alsogaray" <martin@fondo.com>  ->  { name, address }
function parseFromHeader(from: string | undefined): { name: string; address: string } {
  if (!from) return { name: 'Desconocido', address: 'unknown@unknown' };
  const match = from.match(/^\s*"?([^"<]*)"?\s*<?([^<>\s]+@[^<>\s]+)>?\s*$/);
  if (!match) return { name: from, address: from };
  const [, rawName, address] = match;
  const name = rawName.trim() || address;
  return { name, address };
}

async function importMessage(channel: GmailChannel, msg: gmail_v1.Schema$Message): Promise<void> {
  const labelIds = msg.labelIds ?? [];
  const direction = labelIds.includes('SENT') ? 'outbound' : 'inbound';
  const { name, address } = parseFromHeader(header(msg, direction === 'inbound' ? 'From' : 'To'));
  const subject = header(msg, 'Subject') ?? '(sin asunto)';
  const body = extractBody(msg.payload) ?? msg.snippet ?? '';
  const content = `${subject}\n\n${body}`.trim();

  console.log(`[gmail:${channel}] buscando/creando contacto para ${address}`);
  const contact = await findOrCreateContactByChannel({ channel, address }, name);
  console.log(`[gmail:${channel}] contact_id=${contact.id}, insertando mensaje ${msg.id}`);

  await insertRawMessage({
    channel,
    contact_id: contact.id,
    thread_id: msg.threadId ?? null,
    external_id: msg.id ?? null,
    direction,
    content,
    received_at: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
  });
}

export interface GmailSyncResult {
  channel: GmailChannel;
  imported: number;
}

export async function syncGmailAccount(channel: GmailChannel): Promise<GmailSyncResult> {
  console.log(`[gmail:${channel}] sync start`);
  const gmail = gmailClientFor(channel);
  const state = await getSyncState(channel as Channel);
  let imported = 0;

  try {
    if (!state.last_cursor) {
      // Primera corrida: full sync acotado + tomamos el historyId actual como punto de partida
      const list = await gmail.users.messages.list({
        userId: 'me',
        maxResults: INITIAL_SYNC_MAX_RESULTS,
        labelIds: ['INBOX'],
      });
      const ids = list.data.messages ?? [];
      console.log(`[gmail:${channel}] full sync: ${ids.length} mensajes en INBOX`);
      for (const { id } of ids) {
        if (!id) continue;
        console.log(`[gmail:${channel}] importando mensaje ${id}`);
        const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        await importMessage(channel, full.data);
        imported++;
      }
      const profile = await gmail.users.getProfile({ userId: 'me' });
      await updateSyncState(channel as Channel, {
        last_cursor: profile.data.historyId ?? null,
        last_run_at: new Date().toISOString(),
        last_status: 'ok',
        last_error: null,
      });
      return { channel, imported };
    }

    // Corridas siguientes: incremental via history.list
    let pageToken: string | undefined;
    let latestHistoryId = state.last_cursor;
    const seenMessageIds = new Set<string>();

    do {
      const history = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: state.last_cursor,
        historyTypes: ['messageAdded'],
        pageToken,
      });

      for (const record of history.data.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const id = added.message?.id;
          if (!id || seenMessageIds.has(id)) continue;
          seenMessageIds.add(id);
          const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
          await importMessage(channel, full.data);
          imported++;
        }
      }

      if (history.data.historyId) latestHistoryId = history.data.historyId;
      pageToken = history.data.nextPageToken ?? undefined;
    } while (pageToken);

    await updateSyncState(channel as Channel, {
      last_cursor: latestHistoryId,
      last_run_at: new Date().toISOString(),
      last_status: 'ok',
      last_error: null,
    });
    return { channel, imported };
  } catch (err) {
    await updateSyncState(channel as Channel, {
      last_run_at: new Date().toISOString(),
      last_status: 'error',
      last_error: serializeError(err),
    });
    throw err;
  }
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export async function syncAllGmailAccounts(): Promise<GmailSyncResult[]> {
  const results: GmailSyncResult[] = [];
  for (const channel of GMAIL_CHANNELS) {
    // Secuencial a proposito: son 3 cuentas nada mas, y evita pisarse con
    // rate limits de la Gmail API corriendo todo en paralelo.
    results.push(await syncGmailAccount(channel));
  }
  return results;
}
