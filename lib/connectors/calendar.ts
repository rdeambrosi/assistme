// Crea eventos de Google Calendar con Meet automatico (conferenceDataVersion:1).
// Usa el mismo refresh token que el conector de Gmail para la cuenta que
// corresponda (GMAIL_1/2/3_REFRESH_TOKEN, que ahora incluye el scope
// calendar.events ademas de gmail.*) — asi cada mensaje reserva en el
// calendario de la cuenta por la que llego, no uno solo compartido.
import { google, calendar_v3 } from 'googleapis';
import { isGmailChannel, type GmailChannel } from '@/lib/connectors/gmail';
import type { Channel } from '@/lib/db/types';

// Mensajes que no llegaron por Gmail (Telegram/WhatsApp) no tienen una
// cuenta de Google propia — caen en esta por default.
const DEFAULT_CALENDAR_CHANNEL: GmailChannel = 'gmail_1';

// URL de la "Appointment schedule" (pagina de reserva) de la cuenta que
// corresponda — no se puede crear via API, solo leer la que ya existe
// (GMAIL_N_BOOKING_URL). Usado tanto por /api/messages/[id]/booking-link
// como por el draft de Claude (para que pueda ofrecerlo sin inventar una URL).
export function getBookingUrl(channel: Channel): string | null {
  const gmailChannel = isGmailChannel(channel) ? channel : DEFAULT_CALENDAR_CHANNEL;
  return process.env[`${gmailChannel.toUpperCase()}_BOOKING_URL`] ?? null;
}

function getClient(channel: Channel): calendar_v3.Calendar {
  const gmailChannel = isGmailChannel(channel) ? channel : DEFAULT_CALENDAR_CHANNEL;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env[`${gmailChannel.toUpperCase()}_REFRESH_TOKEN`];
  if (!clientId || !clientSecret) {
    throw new Error('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el entorno');
  }
  if (!refreshToken) {
    throw new Error(`Falta ${gmailChannel.toUpperCase()}_REFRESH_TOKEN en el entorno`);
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

export interface CreateMeetingParams {
  channel: Channel;
  summary: string;
  description?: string;
  startISO: string;
  endISO: string;
  attendeeEmail?: string | null;
}

export interface CreateMeetingResult {
  eventLink: string | null;
  meetLink: string | null;
}

export async function createMeeting(params: CreateMeetingParams): Promise<CreateMeetingResult> {
  const calendar = getClient(params.channel);

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    sendUpdates: params.attendeeEmail ? 'all' : 'none',
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startISO },
      end: { dateTime: params.endISO },
      attendees: params.attendeeEmail ? [{ email: params.attendeeEmail }] : undefined,
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });

  const meetEntry = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return { eventLink: data.htmlLink ?? null, meetLink: meetEntry?.uri ?? null };
}
