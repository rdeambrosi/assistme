import type { Channel } from '@/lib/db/types';

export type UiChannel = 'gmail' | 'telegram' | 'whatsapp';

// gmail_1/2/3 comparten el mismo estilo visual (dot color, tag) en la UI —
// solo importa distinguirlos a nivel de datos/sync, no en el blotter.
export function uiChannel(channel: Channel): UiChannel {
  return channel.startsWith('gmail') ? 'gmail' : (channel as UiChannel);
}

export const channelLabel: Record<UiChannel, string> = {
  gmail: 'Gmail',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
};

// Las 3 casillas de Gmail (ver README: GMAIL_1/2/3_REFRESH_TOKEN) — sin esto
// la UI las trata a todas como "Gmail" y no hay forma de saber de cual vino
// un mensaje en particular.
export const GMAIL_ACCOUNT_LABEL: Partial<Record<Channel, string>> = {
  gmail_1: '#1 Personal',
  gmail_2: '#2 Twin',
  gmail_3: '#3 Belo',
};

export function gmailAccountLabel(channel: Channel): string | null {
  return GMAIL_ACCOUNT_LABEL[channel] ?? null;
}

export function formatWait(receivedAt: string): string {
  const ms = Date.now() - new Date(receivedAt).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
