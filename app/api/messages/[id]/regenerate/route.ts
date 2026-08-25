// POST { tono, contexto, formato } — botón "Regenerar draft" del panel de
// skills: persiste la seleccion tildada y vuelve a llamar a Claude con ese
// contexto extra.
import { NextRequest, NextResponse } from 'next/server';
import { saveMessageSkills } from '@/lib/db/client';
import { generateDraft } from '@/lib/ai/draft';
import { serializeError } from '@/lib/api-error';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    await saveMessageSkills(id, {
      tono: body.tono ?? null,
      contexto: Array.isArray(body.contexto) ? body.contexto : [],
      formato: body.formato ?? null,
    });
    const result = await generateDraft(id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error(`[/api/messages/${id}/regenerate] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
