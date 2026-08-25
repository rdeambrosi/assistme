// PATCH { notes: string } — pantalla de "Contactos y contexto" de la UI.
import { NextRequest, NextResponse } from 'next/server';
import { updateContactNotes } from '@/lib/db/client';
import { serializeError } from '@/lib/api-error';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (typeof body.notes !== 'string') {
      return NextResponse.json({ ok: false, error: 'Falta "notes" (string) en el body' }, { status: 400 });
    }
    await updateContactNotes(id, body.notes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[/api/contacts/${id}] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
