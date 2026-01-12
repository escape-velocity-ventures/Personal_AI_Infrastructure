import type { CalendarAdapter, GoogleCalendarSource, UnifiedEvent } from '../types';

// Import from pai-google-workspace (absolute path)
const PAI_PACKS = process.env.PAI_PACKS || '/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs';
const GOOGLE_WORKSPACE_PATH = `${PAI_PACKS}/pai-google-workspace/src`;

interface GoogleEvent {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  htmlLink?: string;
}

export const googleAdapter: CalendarAdapter = {
  type: 'google',

  async getEvents(
    source: GoogleCalendarSource,
    startDate: Date,
    endDate: Date
  ): Promise<UnifiedEvent[]> {
    // Dynamically import to avoid circular dependencies
    const { calendar, forAccount } = await import(
      `${GOOGLE_WORKSPACE_PATH}/lib/google-client`
    );

    const client = source.account ? forAccount(source.account).calendar : calendar;
    const calendarId = source.calendarId || 'primary';

    // Calculate days from date range
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    const events: GoogleEvent[] = await client.listEvents(calendarId, days);

    return events.map((event) => {
      const isAllDay = !event.start.dateTime;
      const startStr = event.start.dateTime || event.start.date || '';
      const endStr = event.end.dateTime || event.end.date || '';

      return {
        id: `google:${source.account}:${event.id}`,
        title: event.summary || '(No title)',
        start: new Date(startStr),
        end: new Date(endStr),
        allDay: isAllDay,
        location: event.location,
        description: event.description,
        source: {
          type: 'google',
          label: source.label,
          account: source.account,
        },
        url: event.htmlLink,
        raw: event,
      };
    });
  },
};
