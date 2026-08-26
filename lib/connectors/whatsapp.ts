// Envio de mensajes via WhatsApp Business Platform (Cloud API de Meta).
// El webhook (app/api/webhooks/whatsapp/route.ts) solo recibe; esto es la
// otra mitad, para cuando se aprueba un draft.
const GRAPH_API_VERSION = 'v21.0';

export async function sendWhatsAppMessage(toWaId: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_BUSINESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token) throw new Error('Falta WHATSAPP_BUSINESS_TOKEN en el entorno');
  if (!phoneNumberId) throw new Error('Falta WHATSAPP_PHONE_NUMBER_ID en el entorno');

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toWaId,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp API error ${res.status}: ${await res.text()}`);
  }
}

// Manda el recibo de lectura (doble tilde azul) del lado de WhatsApp cuando
// se marca leido aca — sin esto, "Marcar leido" en assist-me no se refleja
// en la app real.
export async function markWhatsAppRead(messageId: string): Promise<void> {
  const token = process.env.WHATSAPP_BUSINESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token) throw new Error('Falta WHATSAPP_BUSINESS_TOKEN en el entorno');
  if (!phoneNumberId) throw new Error('Falta WHATSAPP_PHONE_NUMBER_ID en el entorno');

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp API error ${res.status}: ${await res.text()}`);
  }
}
