// Conector de Telegram via MTProto (teleproto, fork mantenido de GramJS) —
// no Bot API, porque necesitamos leer/escribir en la cuenta personal, no en
// un bot separado. Corre en ejecucion puntual (no proceso persistente): se
// autentica con la StringSession generada una vez con
// scripts/telegram-auth.ts, sincroniza, y corta.
//
// Cursor: a diferencia de Gmail (un historyId por cuenta), Telegram tiene
// multiples chats — cada uno con su propio cursor de "ultimo message_id
// procesado" en telegram_chat_cursors. sync_state.telegram solo trackea
// last_run_at/last_status general (ver comentario en el schema).
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import {
  findOrCreateContactByChannel,
  getTelegramCursor,
  insertRawMessage,
  updateSyncState,
  upsertTelegramCursor,
} from '@/lib/db/client';

// Cuantos chats/mensajes procesar por corrida — igual que Gmail, para no
// pegarse contra el limite de 60s de las funciones serverless de Vercel.
const MAX_DIALOGS = 30;
const MAX_MESSAGES_PER_DIALOG_INITIAL = 20;

// Nombre para mostrar de quien mando un mensaje puntual dentro de un grupo
// (distinto del contacto/chat entero). Solo Api.User trae firstName/lastName —
// un grupo/canal como remitente (mensajes de "canal anonimo") no los tiene.
async function senderDisplayName(msg: Api.Message): Promise<string | null> {
  const sender = await msg.getSender();
  if (!sender || !(sender instanceof Api.User)) return null;
  const fullName = [sender.firstName, sender.lastName].filter(Boolean).join(' ');
  if (fullName) return fullName;
  if (sender.username) return `@${sender.username}`;
  return null;
}

function getClient(): TelegramClient {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION_STRING;
  if (!apiId || !apiHash) throw new Error('Faltan TELEGRAM_API_ID / TELEGRAM_API_HASH en el entorno');
  if (!sessionString) throw new Error('Falta TELEGRAM_SESSION_STRING en el entorno');
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 3 });
}

export interface TelegramSyncResult {
  dialogsProcessed: number;
  imported: number;
}

export async function syncTelegram(): Promise<TelegramSyncResult> {
  const client = getClient();
  await client.connect();
  let imported = 0;
  let dialogsProcessed = 0;

  try {
    const dialogs = await client.getDialogs({ limit: MAX_DIALOGS });

    for (const dialog of dialogs) {
      if (!dialog.id || dialog.isChannel) continue; // canales de difusion quedan fuera, solo chats/grupos personales
      const chatId = dialog.id.toJSNumber();
      dialogsProcessed++;

      const cursor = await getTelegramCursor(chatId);
      const minId = cursor?.last_message_id ?? undefined;

      const messages = await client.getMessages(dialog.entity, {
        limit: minId ? undefined : MAX_MESSAGES_PER_DIALOG_INITIAL,
        minId,
        reverse: true, // de mas viejo a mas nuevo, para importar en orden y dejar el cursor en el ultimo
      });

      let latestId = cursor?.last_message_id ?? 0;
      for (const msg of messages) {
        if (!msg.message) continue; // solo texto por ahora — media/stickers/etc se saltean
        const direction = msg.out ? 'outbound' : 'inbound';
        const contact = await findOrCreateContactByChannel(
          { channel: 'telegram', chat_id: chatId },
          dialog.name ?? dialog.title ?? `Chat ${chatId}`
        );

        await insertRawMessage({
          channel: 'telegram',
          contact_id: contact.id,
          thread_id: String(chatId),
          external_id: `${chatId}:${msg.id}`,
          direction,
          // solo interesa distinguir remitente en chats con mas de una
          // persona posible (grupos) — en un 1:1 ya lo dice contact_id.
          sender_name: dialog.isGroup ? await senderDisplayName(msg) : null,
          content: msg.message,
          received_at: new Date(msg.date * 1000).toISOString(),
        });
        imported++;
        if (msg.id > latestId) latestId = msg.id;
      }

      if (latestId > (cursor?.last_message_id ?? 0)) {
        await upsertTelegramCursor(chatId, latestId);
      }
    }

    await updateSyncState('telegram', {
      last_run_at: new Date().toISOString(),
      last_status: 'ok',
      last_error: null,
    });
    return { dialogsProcessed, imported };
  } catch (err) {
    await updateSyncState('telegram', {
      last_run_at: new Date().toISOString(),
      last_status: 'error',
      last_error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    await client.disconnect();
  }
}
