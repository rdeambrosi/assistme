// Completa messages.sender_name para mensajes de grupos de Telegram que se
// importaron antes de la migracion 0002 (el sync solo empezo a guardar el
// remitente de ahi en mas). Se corre una sola vez a mano:
//
//   npm run telegram:backfill-senders
//
// Requiere las mismas env vars que el sync (TELEGRAM_API_ID/HASH/SESSION_STRING,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — `vercel env pull .env.local` antes
// si no las tenes localmente.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { getMessagesMissingSenderName, updateMessageSenderName } from '@/lib/db/client';
import { senderDisplayName } from '@/lib/connectors/telegram';

// Mas holgado que MAX_DIALOGS del sync (30) — esto corre una sola vez y
// preferimos cubrir todos los chats existentes antes que ser rapidos.
const MAX_DIALOGS = 300;

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION_STRING;
  if (!apiId || !apiHash || !sessionString) {
    console.error('Faltan TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_STRING en .env.local');
    process.exit(1);
  }

  const pending = await getMessagesMissingSenderName('telegram');
  if (pending.length === 0) {
    console.log('Nada para completar — todos los mensajes de Telegram ya tienen sender_name.');
    return;
  }
  console.log(`${pending.length} mensajes de Telegram sin sender_name.`);

  const byChat = new Map<string, typeof pending>();
  for (const msg of pending) {
    if (!msg.thread_id || !msg.external_id) continue; // sin chat_id/external_id no hay como ubicar el mensaje puntual
    const list = byChat.get(msg.thread_id) ?? [];
    list.push(msg);
    byChat.set(msg.thread_id, list);
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 3 });
  await client.connect();

  try {
    const dialogs = await client.getDialogs({ limit: MAX_DIALOGS });
    const dialogByChatId = new Map(dialogs.filter((d) => d.id).map((d) => [String(d.id!.toJSNumber()), d]));

    let updated = 0;
    let skippedNotGroup = 0;
    for (const [chatId, messages] of byChat) {
      const dialog = dialogByChatId.get(chatId);
      if (!dialog) {
        console.warn(`Chat ${chatId} no aparece entre los ultimos ${MAX_DIALOGS} dialogs — se saltea`);
        continue;
      }
      if (!dialog.isGroup) {
        // igual que el sync: en un 1:1 el remitente ya lo dice contact_id/direction
        skippedNotGroup += messages.length;
        continue;
      }

      const msgIds = messages.map((m) => Number(m.external_id!.split(':')[1]));
      const tgMessages = await client.getMessages(dialog.entity, { ids: msgIds });
      const byMsgId = new Map(tgMessages.filter(Boolean).map((m) => [m.id, m]));

      for (const msg of messages) {
        const msgId = Number(msg.external_id!.split(':')[1]);
        const tgMsg = byMsgId.get(msgId);
        if (!tgMsg) continue; // mensaje borrado en Telegram desde que se importo
        const sender = await senderDisplayName(tgMsg);
        if (!sender) continue; // deja null si no se pudo resolver (cuenta borrada, etc.)
        await updateMessageSenderName(msg.id, sender);
        updated++;
      }
    }

    console.log(`Listo — ${updated} mensajes actualizados, ${skippedNotGroup} saltados (no son de grupo).`);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
