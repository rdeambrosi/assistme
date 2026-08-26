// Crea eventos de Google Calendar con Meet automatico (conferenceDataVersion:1).
// Reusa el OAuth client de Gmail (GOOGLE_CLIENT_ID/SECRET) con un refresh
// token propio autorizado para el scope de Calendar.
import { google, calendar_v3 } from 'googleapis';

function getClient(): calendar_v3.Calendar {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el entorno');
  }
  if (!refreshToken) {
    throw new Error('Falta GOOGLE_CALENDAR_REFRESH_TOKEN en el entorno');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

export interface CreateMeetingParams {
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
  const calendar = getClient();

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
