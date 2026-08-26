// Propaga "marcar leido" al canal de origen (Telegram/Gmail/WhatsApp) —
// sin esto, marcar leido en assist-me solo actualiza nuestra DB y el chat
// real sigue mostrando el mensaje como no leido. Separado de lib/send.ts
// porque es un flujo distinto (no manda nada, solo reconoce lectura) pero
// sigue el mismo patron de "mirar el channel del mensaje y despachar".
import type { Message } from '@/lib/db/types';
import { isGmailChannel, markGmailRead } from '@/lib/connectors/gmail';
import { markTelegramRead } from '@/lib/connectors/telegram';
import { markWhatsAppRead } from '@/lib/connectors/whatsapp';

export async function markSourceRead(message: Message): Promise<void> {
  if (isGmailChannel(message.channel)) {
    if (!message.external_id) return; // nada que marcar si no vino de un sync real
    await markGmailRead(message.channel, message.external_id);
    return;
  }

  if (message.channel === 'telegram') {
    if (!message.thread_id || !message.external_id) return;
    const rawId = message.external_id.split(':').pop();
    const messageId = rawId ? Number(rawId) : NaN;
    if (Number.isNaN(messageId)) return;
    await markTelegramRead(Number(message.thread_id), messageId);
    return;
  }

  if (message.channel === 'whatsapp') {
    if (!message.external_id) return;
    await markWhatsAppRead(message.external_id);
    return;
  }
}
