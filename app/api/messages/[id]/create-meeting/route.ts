// POST { date: "2026-09-18", time: "15:00" } — botón "Crear evento + Meet"
// del panel de sugerencia de reunion. Duracion fija de 30 min por ahora.
import { NextRequest, NextResponse } from 'next/server';
import { getContact, getMessage } from '@/lib/db/client';
import { createMeeting } from '@/lib/connectors/calendar';
import { serializeError } from '@/lib/api-error';

const MEETING_DURATION_MINUTES = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (typeof body.date !== 'string' || typeof body.time !== 'string') {
      return NextResponse.json({ ok: false, error: 'Faltan "date" y "time" (string) en el body' }, { status: 400 });
    }

    const message = await getMessage(id);
    if (!message) return NextResponse.json({ ok: false, error: 'Mensaje no encontrado' }, { status: 404 });

    const contact = message.contact_id ? await getContact(message.contact_id) : null;
    const attendeeEmail =
      contact?.channels.find((ch) => ch.channel === message.channel && ch.address)?.address ?? null;

    const start = new Date(`${body.date}T${body.time}:00`);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ ok: false, error: 'date/time invalidos' }, { status: 400 });
    }
    const end = new Date(start.getTime() + MEETING_DURATION_MINUTES * 60 * 1000);

    const result = await createMeeting({
      channel: message.channel,
      summary: `Reunión con ${contact?.name ?? 'contacto'}`,
      description: message.content.slice(0, 500),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      attendeeEmail,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[/api/messages/${id}/create-meeting] failed:`, err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
