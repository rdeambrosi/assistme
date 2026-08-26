// POST multipart/form-data { audio } — "Responder con audio": Rafa dicta que
// quiere que diga la respuesta (no el texto final en si). Se transcribe con
// Whisper y esa transcripcion se le pasa a Claude como instruccion puntual
// para redactar el draft de este mensaje.
import { NextRequest, NextResponse } from 'next/server';
import { generateDraft } from '@/lib/ai/draft';
import { transcribeAudio } from '@/lib/ai/transcribe';
import { serializeError } from '@/lib/api-error';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const form = await req.formData();
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ ok: false, error: 'Falta el audio grabado' }, { status: 400 });
    }

    const instruction = await transcribeAudio(audio);
    const result = await generateDraft(id, { instruction });
    return NextResponse.json({ ok: true, instruction, result });
  } catch (err) {
    console.error(`[/api/messages/${id}/voice-instruction] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
