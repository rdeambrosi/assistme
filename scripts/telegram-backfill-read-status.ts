// Reconcilia mensajes de Telegram que quedaron 'pending' en assist-me pero
// ya estan leidos en Telegram (desde el celular u otro cliente, antes de que
// el sync supiera fijarse en readInboxMaxId — ver lib/connectors/telegram.ts).
// Se corre una sola vez a mano:
//
//   npm run telegram:backfill-read-status
//
// Requiere las mismas env vars que el sync (TELEGRAM_API_ID/HASH/SESSION_STRING,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — `vercel env pull .env.local` antes
// si no las tenes localmente.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { getPendingOrDraftedMessages, markMessagesRead } from '@/lib/db/client';

const MAX_DIALOGS = 300;

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION_STRING;
  if (!apiId || !apiHash || !sessionString) {
    console.error('Faltan TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_STRING en .env.local');
    process.exit(1);
  }

  const pending = await getPendingOrDraftedMessages('telegram');
  if (pending.length === 0) {
    console.log('Nada pendiente de Telegram para reconciliar.');
    return;
  }
  console.log(`${pending.length} mensajes de Telegram en estado pending/drafted.`);

  const byChat = new Map<string, typeof pending>();
  for (const msg of pending) {
    if (!msg.thread_id || !msg.external_id) continue;
    const list = byChat.get(msg.thread_id) ?? [];
    list.push(msg);
    byChat.set(msg.thread_id, list);
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 3 });
  await client.connect();

  try {
    const dialogs = await client.getDialogs({ limit: MAX_DIALOGS });
    const dialogByChatId = new Map(dialogs.filter((d) => d.id).map((d) => [String(d.id!.toJSNumber()), d]));

    const toMarkRead: string[] = [];
    let skippedNoDialog = 0;
    for (const [chatId, messages] of byChat) {
      const dialog = dialogByChatId.get(chatId);
      if (!dialog) {
        console.warn(`Chat ${chatId} no aparece entre los ultimos ${MAX_DIALOGS} dialogs — se saltea`);
        skippedNoDialog += messages.length;
        continue;
      }
      const readInboxMaxId = dialog.dialog.readInboxMaxId ?? 0;
      for (const msg of messages) {
        const msgId = Number(msg.external_id!.split(':').pop());
        if (!Number.isNaN(msgId) && msgId <= readInboxMaxId) toMarkRead.push(msg.id);
      }
    }

    await markMessagesRead(toMarkRead);
    console.log(
      `Listo — ${toMarkRead.length} mensajes marcados 'read', ${skippedNoDialog} saltados (chat no encontrado).`
    );
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
