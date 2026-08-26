// Envia el draft aprobado de un mensaje por el canal que corresponda.
// Separado de los connectors individuales porque necesita mirar el
// `channel`/`contact` del mensaje para decidir cual usar — no es logica de
// ningun canal en particular.
import { getContact } from '@/lib/db/client';
import type { Message } from '@/lib/db/types';
import { isGmailChannel, sendGmailReply } from '@/lib/connectors/gmail';
import { sendTelegramMessage } from '@/lib/connectors/telegram';
import { sendWhatsAppMessage } from '@/lib/connectors/whatsapp';

// content se guarda como "asunto\n\ncuerpo" (ver lib/connectors/gmail.ts) —
// solo importa para reconstruir el "Re: <asunto>" del email de respuesta.
function splitSubject(content: string): string {
  return content.split('\n\n')[0] || '(sin asunto)';
}

export async function sendApprovedMessage(message: Message): Promise<void> {
  if (!message.draft_content) throw new Error('El mensaje no tiene draft para enviar');

  if (isGmailChannel(message.channel)) {
    const contact = message.contact_id ? await getContact(message.contact_id) : null;
    const toAddress = contact?.channels.find((ch) => ch.channel === message.channel)?.address;
    if (!toAddress) throw new Error('No se encontro la direccion de email del contacto');
    if (!message.thread_id || !message.external_id) {
      throw new Error('Falta thread_id/external_id para responder este mensaje');
    }
    await sendGmailReply({
      channel: message.channel,
      threadId: message.thread_id,
      originalExternalId: message.external_id,
      toAddress,
      subject: splitSubject(message.content),
      body: message.draft_content,
    });
    return;
  }

  if (message.channel === 'telegram') {
    const contact = message.contact_id ? await getContact(message.contact_id) : null;
    const chatId = contact?.channels.find((ch) => ch.channel === 'telegram')?.chat_id;
    if (chatId == null) throw new Error('No se encontro el chat_id de Telegram del contacto');
    await sendTelegramMessage(chatId, message.draft_content);
    return;
  }

  if (message.channel === 'whatsapp') {
    const contact = message.contact_id ? await getContact(message.contact_id) : null;
    const chatId = contact?.channels.find((ch) => ch.channel === 'whatsapp')?.chat_id;
    if (chatId == null) throw new Error('No se encontro el chat_id de WhatsApp del contacto');
    await sendWhatsAppMessage(String(chatId), message.draft_content);
    return;
  }

  throw new Error(`Canal no soportado para envio: ${message.channel}`);
}
