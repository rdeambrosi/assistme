// Genera drafts para mensajes 'pending' via Claude. Separado de /api/sync
// para no competir por los 60s de limite en funciones serverless de Vercel
// Hobby — sync trae mensajes, draft los procesa en tandas, cada uno con su
// propio cron (ver vercel.json).
import { NextRequest, NextResponse } from 'next/server';
import { draftPendingMessages } from '@/lib/ai/draft';

export const maxDuration = 60;

// Tandas chicas: cada draft hace ~2 llamadas de red (Voyage + Claude) y el
// limite duro de Vercel Hobby es 60s por invocacion.
const DEFAULT_BATCH_SIZE = 10;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : DEFAULT_BATCH_SIZE;

  try {
    const results = await draftPendingMessages(limit);
    return NextResponse.json({
      ok: true,
      drafted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok),
    });
  } catch (err) {
    console.error('[/api/draft] failed:', err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export const POST = GET;
