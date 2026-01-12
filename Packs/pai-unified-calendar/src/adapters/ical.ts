import type { CalendarAdapter, ICalCalendarSource, UnifiedEvent } from '../types';

interface ICalEvent {
  uid: string;
  summary: string;
  dtstart: Date;
  dtend: Date;
  location?: string;
  description?: string;
  url?: string;
}

// Simple iCal parser (doesn't require external library for basic use)
function parseICalDate(value: string): Date {
  // Handle formats: 20260115T140000Z or 20260115
  if (value.includes('T')) {
    // DateTime format
    const year = parseInt(value.slice(0, 4));
    const month = parseInt(value.slice(4, 6)) - 1;
    const day = parseInt(value.slice(6, 8));
    const hour = parseInt(value.slice(9, 11));
    const minute = parseInt(value.slice(11, 13));
    const second = parseInt(value.slice(13, 15)) || 0;

    if (value.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }
    return new Date(year, month, day, hour, minute, second);
  } else {
    // Date only format
    const year = parseInt(value.slice(0, 4));
    const month = parseInt(value.slice(4, 6)) - 1;
    const day = parseInt(value.slice(6, 8));
    return new Date(year, month, day);
  }
}

function parseICalContent(content: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  const lines = content.split(/\r?\n/);

  let currentEvent: Partial<ICalEvent> | null = null;
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    // Handle line folding (lines starting with space/tab are continuations)
    if (line.startsWith(' ') || line.startsWith('\t')) {
      currentValue += line.slice(1);
      continue;
    }

    // Process previous key-value if exists
    if (currentKey && currentEvent) {
      processKeyValue(currentEvent, currentKey, currentValue);
    }

    // Parse new line
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    currentKey = line.slice(0, colonIndex);
    currentValue = line.slice(colonIndex + 1);

    // Handle VEVENT boundaries
    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.uid && currentEvent.dtstart) {
        events.push(currentEvent as ICalEvent);
      }
      currentEvent = null;
    }
  }

  return events;
}

function processKeyValue(event: Partial<ICalEvent>, key: string, value: string): void {
  // Remove parameters from key (e.g., DTSTART;TZID=America/Los_Angeles)
  const baseKey = key.split(';')[0];

  switch (baseKey) {
    case 'UID':
      event.uid = value;
      break;
    case 'SUMMARY':
      event.summary = unescapeICalString(value);
      break;
    case 'DTSTART':
      event.dtstart = parseICalDate(value);
      break;
    case 'DTEND':
      event.dtend = parseICalDate(value);
      break;
    case 'LOCATION':
      event.location = unescapeICalString(value);
      break;
    case 'DESCRIPTION':
      event.description = unescapeICalString(value);
      break;
    case 'URL':
      event.url = value;
      break;
  }
}

function unescapeICalString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// Cache for iCal feeds
const cache = new Map<string, { data: ICalEvent[]; timestamp: number }>();

function parseRefreshInterval(interval: string): number {
  const match = interval.match(/^(\d+)(h|m|d)$/);
  if (!match) return 60 * 60 * 1000; // default 1 hour

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

export const icalAdapter: CalendarAdapter = {
  type: 'ical',

  async getEvents(
    source: ICalCalendarSource,
    startDate: Date,
    endDate: Date
  ): Promise<UnifiedEvent[]> {
    const cacheKey = source.url;
    const refreshMs = parseRefreshInterval(source.refreshInterval || '1h');
    const now = Date.now();

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < refreshMs) {
      return filterEventsByDateRange(cached.data, source, startDate, endDate);
    }

    // Fetch iCal feed
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch iCal feed: ${response.status}`);
    }

    const content = await response.text();
    const events = parseICalContent(content);

    // Update cache
    cache.set(cacheKey, { data: events, timestamp: now });

    return filterEventsByDateRange(events, source, startDate, endDate);
  },
};

function filterEventsByDateRange(
  events: ICalEvent[],
  source: ICalCalendarSource,
  startDate: Date,
  endDate: Date
): UnifiedEvent[] {
  return events
    .filter((event) => {
      const eventStart = event.dtstart;
      const eventEnd = event.dtend || event.dtstart;
      return eventStart <= endDate && eventEnd >= startDate;
    })
    .map((event) => {
      const isAllDay =
        event.dtstart.getHours() === 0 &&
        event.dtstart.getMinutes() === 0 &&
        (!event.dtend ||
          (event.dtend.getHours() === 0 && event.dtend.getMinutes() === 0));

      return {
        id: `ical:${source.label}:${event.uid}`,
        title: event.summary || '(No title)',
        start: event.dtstart,
        end: event.dtend || event.dtstart,
        allDay: isAllDay,
        location: event.location,
        description: event.description,
        source: {
          type: 'ical' as const,
          label: source.label,
        },
        url: event.url,
        raw: event,
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
