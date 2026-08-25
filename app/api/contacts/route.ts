import { NextResponse } from 'next/server';
import { getAllContacts } from '@/lib/db/client';
import { serializeError } from '@/lib/api-error';

export async function GET() {
  try {
    const contacts = await getAllContacts();
    return NextResponse.json({ ok: true, contacts });
  } catch (err) {
    console.error('[/api/contacts] failed:', err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
