// POST { status: 'approved' | 'skipped' } — botones Aprobar/Descartar de la UI.
// 'approved' todavia no dispara el envio real (eso es un paso futuro del
// handoff, por conector); por ahora solo marca el estado.
import { NextRequest, NextResponse } from 'next/server';
import { setMessageStatus } from '@/lib/db/client';
import type { MessageStatus } from '@/lib/db/types';
import { serializeError } from '@/lib/api-error';

const ALLOWED: MessageStatus[] = ['approved', 'skipped'];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (!ALLOWED.includes(body.status)) {
      return NextResponse.json({ ok: false, error: `status debe ser uno de: ${ALLOWED.join(', ')}` }, { status: 400 });
    }
    await setMessageStatus(id, body.status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[/api/messages/${id}/status] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
