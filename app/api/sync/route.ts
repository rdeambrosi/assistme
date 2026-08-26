// Endpoint que dispara el sync de mensajes. Lo llama tanto el cron de Vercel
// como un trigger manual (ver vercel.json). Orquesta Gmail + Telegram —
// WhatsApp se suma aca cuando exista su conector (webhook, patron distinto).
// Cada canal se corre de forma independiente: si Telegram falla (por
// ejemplo la sesion vencio), Gmail igual se sincroniza y viceversa.
import { NextRequest, NextResponse } from 'next/server';
import { syncAllGmailAccounts } from '@/lib/connectors/gmail';
import { syncTelegram } from '@/lib/connectors/telegram';
import { serializeError } from '@/lib/api-error';
import { SESSION_COOKIE, sha256Hex } from '@/lib/auth';

export const maxDuration = 60;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true; // cron de Vercel

  // Boton "Actualizar" del dashboard: llega con la cookie de sesion, no con
  // el bearer del cron — proxy.ts ya lo dejo pasar, pero esto tambien vale
  // como ruta directa (sin proxy) para dev/tests.
  const password = process.env.DASHBOARD_PASSWORD;
  if (password) {
    const expected = await sha256Hex(password);
    if (req.cookies.get(SESSION_COOKIE)?.value === expected) return true;
  }

  // Sin CRON_SECRET ni DASHBOARD_PASSWORD configurados no se exige auth —
  // solo pasa en dev local.
  return !secret && !password;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
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
