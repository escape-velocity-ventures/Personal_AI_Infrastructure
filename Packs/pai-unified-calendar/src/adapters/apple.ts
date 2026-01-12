import type { CalendarAdapter, AppleCalendarSource, UnifiedEvent } from '../types';

// Import from pai-apple-ecosystem (absolute path)
const PAI_PACKS = process.env.PAI_PACKS || '/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs';
const APPLE_ECOSYSTEM_PATH = `${PAI_PACKS}/pai-apple-ecosystem/src`;

interface AppleEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  calendar: string;
  isAllDay: boolean;
  url?: string;
}

// Parse Apple Calendar date strings like "Tuesday, January 13, 2026 at 3:00:00 PM"
function parseAppleDate(dateStr: string): Date {
  if (!dateStr) return new Date();

  // Try standard Date parsing first
  const direct = new Date(dateStr);
  if (!isNaN(direct.getTime())) {
    return direct;
  }

  // Handle format: "Day, Month DD, YYYY at HH:MM:SS AM/PM"
  const match = dateStr.match(
    /(\w+),\s+(\w+)\s+(\d+),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i
  );

  if (match) {
    const [, , monthStr, day, year, hour, minute, second, meridiem] = match;
    const months: Record<string, number> = {
      January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
      July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
    };

    let hours = parseInt(hour);
    if (meridiem.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (meridiem.toUpperCase() === 'AM' && hours === 12) hours = 0;

    return new Date(
      parseInt(year),
      months[monthStr] ?? 0,
      parseInt(day),
      hours,
      parseInt(minute),
      parseInt(second)
    );
  }

  // Fallback
  return new Date();
}

export const appleAdapter: CalendarAdapter = {
  type: 'apple',

  async getEvents(
    source: AppleCalendarSource,
    startDate: Date,
    endDate: Date
  ): Promise<UnifiedEvent[]> {
    // Dynamically import to avoid issues if not on macOS
    const { getEvents } = await import(`${APPLE_ECOSYSTEM_PATH}/calendar/index`);

    let allEvents: AppleEvent[] = [];

    if (source.calendars && source.calendars.length > 0) {
      // Fetch from specific calendars
      for (const calName of source.calendars) {
        const events = await getEvents(startDate, endDate, calName);
        allEvents = allEvents.concat(events);
      }
    } else {
      // Fetch from all calendars
      allEvents = await getEvents(startDate, endDate);
    }

    return allEvents.map((event) => ({
      id: `apple:${event.calendar}:${event.id}`,
      title: event.title || '(No title)',
      start: parseAppleDate(event.startDate),
      end: parseAppleDate(event.endDate),
      allDay: event.isAllDay,
      location: event.location,
      description: event.notes,
      source: {
        type: 'apple',
        label: source.label,
      },
      url: event.url,
      raw: event,
    }));
  },
};
