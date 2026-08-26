// POST { tono, contexto, formato, instruction? } — botón "Regenerar draft"
// del panel de skills, o el botón "Regenerar" junto a "Responder con audio"
// (que manda lo que Rafa ya escribio en el textarea como instruction, igual
// que el flujo de audio pero con texto tipeado en vez de transcripto):
// persiste la seleccion tildada y vuelve a llamar a Claude con ese contexto
// extra.
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
    const instruction = typeof body.instruction === 'string' && body.instruction.trim() ? body.instruction : undefined;
    const result = await generateDraft(id, { instruction });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error(`[/api/messages/${id}/regenerate] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
