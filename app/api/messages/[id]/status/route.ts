// POST { status: 'approved' | 'skipped' | 'read' } — botones Aprobar/Descartar
// y la accion masiva "Marcar leido" de la cola.
// 'approved' dispara el envio real por el canal que corresponda (Gmail
// reply, mensaje de Telegram, o WhatsApp) y, si sale bien, deja el mensaje
// en 'sent'. Si el envio falla, el mensaje se queda como estaba (drafted)
// para que se pueda reintentar o editar el draft, en vez de marcarlo
// "aprobado" con una mentira.
import { NextRequest, NextResponse } from 'next/server';
import { getMessage, setMessageStatus } from '@/lib/db/client';
import { sendApprovedMessage } from '@/lib/send';
import { markSourceRead } from '@/lib/read';
import { serializeError } from '@/lib/api-error';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();

    if (body.status === 'skipped' || body.status === 'read') {
      await setMessageStatus(id, body.status);
      if (body.status === 'read') {
        // Best-effort: si el canal de origen falla (token vencido, etc.) el
        // mensaje ya quedo marcado leido aca, no vale la pena romper la
        // respuesta por eso — solo queda log para diagnosticar despues.
        // Se espera (no fire-and-forget) porque en serverless la funcion
        // puede cortarse apenas se manda la respuesta.
        const message = await getMessage(id);
        if (message && message.direction === 'inbound') {
          try {
            await markSourceRead(message);
          } catch (err) {
            console.error(`[/api/messages/${id}/status] no se pudo marcar leido en origen:`, err);
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (body.status !== 'approved') {
      return NextResponse.json(
        { ok: false, error: 'status debe ser "approved", "skipped" o "read"' },
        { status: 400 }
      );
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
