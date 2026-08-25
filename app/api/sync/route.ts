// Endpoint que dispara el sync de mensajes. Lo llama tanto el cron de Vercel
// como un trigger manual (ver vercel.json). Orquesta Gmail + Telegram —
// WhatsApp se suma aca cuando exista su conector (webhook, patron distinto).
// Cada canal se corre de forma independiente: si Telegram falla (por
// ejemplo la sesion vencio), Gmail igual se sincroniza y viceversa.
import { NextRequest, NextResponse } from 'next/server';
import { syncAllGmailAccounts } from '@/lib/connectors/gmail';
import { syncTelegram } from '@/lib/connectors/telegram';
import { serializeError } from '@/lib/api-error';

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // sin secret configurado, no se exige auth (solo para dev local)
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const [gmail, telegram] = await Promise.allSettled([syncAllGmailAccounts(), syncTelegram()]);

  if (gmail.status === 'rejected') console.error('[/api/sync] gmail failed:', gmail.reason);
  if (telegram.status === 'rejected') console.error('[/api/sync] telegram failed:', telegram.reason);

  const ok = gmail.status === 'fulfilled' && telegram.status === 'fulfilled';
  return NextResponse.json(
    {
      ok,
      gmail: gmail.status === 'fulfilled' ? gmail.value : { error: serializeError(gmail.reason) },
      telegram: telegram.status === 'fulfilled' ? telegram.value : { error: serializeError(telegram.reason) },
    },
    { status: ok ? 200 : 207 } // 207: exito parcial, un canal pudo haber fallado
  );
}

// El trigger manual (botón en la UI, webhook externo) pega un POST al mismo endpoint.
export const POST = GET;
