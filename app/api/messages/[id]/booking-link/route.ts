// GET — devuelve la URL de la "Appointment schedule" (pagina de reserva)
// de Google Calendar que corresponde a la cuenta por la que llego el
// mensaje. Esas paginas no se pueden crear via API (solo a mano, una vez,
// desde calendar.google.com); esto solo lee la URL ya creada, guardada
// como GMAIL_N_BOOKING_URL.
import { NextRequest, NextResponse } from 'next/server';
import { getMessage } from '@/lib/db/client';
import { getBookingUrl } from '@/lib/connectors/calendar';
import { serializeError } from '@/lib/api-error';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const message = await getMessage(id);
    if (!message) return NextResponse.json({ ok: false, error: 'Mensaje no encontrado' }, { status: 404 });

    const url = getBookingUrl(message.channel);
    if (!url) {
      return NextResponse.json({ ok: false, error: 'No hay booking URL configurada para este canal' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, url });
  } catch (err) {
    console.error(`[/api/messages/${id}/booking-link] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
