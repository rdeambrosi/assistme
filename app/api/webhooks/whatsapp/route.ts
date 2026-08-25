// Webhook de WhatsApp Business API (Cloud API de Meta). A diferencia de
// Gmail/Telegram (pull por cursor), WhatsApp empuja los mensajes por HTTP —
// este endpoint solo valida la firma de la suscripcion y escribe directo a
// `messages` (status pending), que ya funciona como la cola pendiente para
// los demas canales. No genera drafts aca: eso lo sigue haciendo /api/draft
// igual que para Gmail y Telegram.
//
// Setup en Meta: App Dashboard -> WhatsApp -> Configuration -> Webhook,
// Callback URL = https://tu-deploy.vercel.app/api/webhooks/whatsapp,
// Verify Token = el mismo valor que WHATSAPP_WEBHOOK_VERIFY_TOKEN.
import { NextRequest, NextResponse } from 'next/server';
import { findOrCreateContactByChannel, insertRawMessage } from '@/lib/db/client';

interface WhatsAppTextMessage {
  from: string; // wa_id del remitente, ej "5491122334455"
  id: string;
  timestamp: string; // unix seconds, como string
  type: string;
  text?: { body: string };
}

interface WhatsAppContact {
  profile?: { name?: string };
  wa_id: string;
}

interface WhatsAppWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        contacts?: WhatsAppContact[];
        messages?: WhatsAppTextMessage[];
      };
    }[];
  }[];
}

// Meta llama a esto una vez, al configurar el webhook, para verificar que
// el endpoint es tuyo.
export function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'verification failed' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  // Siempre respondemos 200 rapido — Meta reintenta (y eventualmente
  // deshabilita el webhook) si no ve un 2xx a tiempo. Los errores de
  // procesamiento quedan en el log del server, no en la respuesta.
  try {
    const payload = (await req.json()) as WhatsAppWebhookPayload;
    await processPayload(payload);
  } catch (err) {
    console.error('[/api/webhooks/whatsapp] failed:', err);
  }
  return NextResponse.json({ success: true });
}

async function processPayload(payload: WhatsAppWebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;

      const contactsByWaId = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));

      for (const msg of value.messages) {
        if (msg.type !== 'text' || !msg.text?.body) continue; // por ahora solo texto — imagen/audio/etc quedan afuera

        const chatId = Number(msg.from);
        const name = contactsByWaId.get(msg.from) ?? msg.from;
        const contact = await findOrCreateContactByChannel({ channel: 'whatsapp', chat_id: chatId }, name);

        await insertRawMessage({
          channel: 'whatsapp',
          contact_id: contact.id,
          thread_id: msg.from,
          external_id: msg.id,
          direction: 'inbound',
          content: msg.text.body,
          received_at: new Date(Number(msg.timestamp) * 1000).toISOString(),
        });
      }
    }
  }
}
