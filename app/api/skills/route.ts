import { NextResponse } from 'next/server';
import { getAllSkills } from '@/lib/db/client';
import { serializeError } from '@/lib/api-error';

export async function GET() {
  try {
    const skills = await getAllSkills();
    return NextResponse.json({ ok: true, skills });
  } catch (err) {
    console.error('[/api/skills] failed:', err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
