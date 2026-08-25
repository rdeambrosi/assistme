// Endpoint que dispara el sync de mensajes. Lo llama tanto el cron de Vercel
// como un trigger manual (ver vercel.json). Por ahora solo orquesta Gmail —
// Telegram y WhatsApp se suman aca cuando existan sus conectores.
import { NextRequest, NextResponse } from 'next/server';
import { syncAllGmailAccounts } from '@/lib/connectors/gmail';
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

  try {
    const gmail = await syncAllGmailAccounts();
    return NextResponse.json({ ok: true, gmail });
  } catch (err) {
    console.error('[/api/sync] failed:', err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}

// El trigger manual (botón en la UI, webhook externo) pega un POST al mismo endpoint.
export const POST = GET;
