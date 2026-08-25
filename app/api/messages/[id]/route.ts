// PATCH: guarda ediciones manuales del draft (textarea de la UI).
import { NextRequest, NextResponse } from 'next/server';
import { updateDraftContent } from '@/lib/db/client';
import { serializeError } from '@/lib/api-error';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (typeof body.draft !== 'string') {
      return NextResponse.json({ ok: false, error: 'Falta "draft" (string) en el body' }, { status: 400 });
    }
    await updateDraftContent(id, body.draft);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[/api/messages/${id}] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
