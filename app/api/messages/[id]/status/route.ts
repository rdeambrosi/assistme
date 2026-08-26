// POST { status: 'approved' | 'skipped' } — botones Aprobar/Descartar de la UI.
// 'approved' dispara el envio real por el canal que corresponda (Gmail
// reply, mensaje de Telegram, o WhatsApp) y, si sale bien, deja el mensaje
// en 'sent'. Si el envio falla, el mensaje se queda como estaba (drafted)
// para que se pueda reintentar o editar el draft, en vez de marcarlo
// "aprobado" con una mentira.
import { NextRequest, NextResponse } from 'next/server';
import { getMessage, setMessageStatus } from '@/lib/db/client';
import { sendApprovedMessage } from '@/lib/send';
import { serializeError } from '@/lib/api-error';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();

    if (body.status === 'skipped') {
      await setMessageStatus(id, 'skipped');
      return NextResponse.json({ ok: true });
    }

    if (body.status !== 'approved') {
      return NextResponse.json({ ok: false, error: 'status debe ser "approved" o "skipped"' }, { status: 400 });
    }

    const message = await getMessage(id);
    if (!message) return NextResponse.json({ ok: false, error: 'Mensaje no encontrado' }, { status: 404 });

    await sendApprovedMessage(message);
    await setMessageStatus(id, 'sent');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[/api/messages/${id}/status] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
