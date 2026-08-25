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
