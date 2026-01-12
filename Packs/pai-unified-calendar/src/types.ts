// Unified event structure across all calendar sources
export interface UnifiedEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  source: {
    type: CalendarSourceType;
    label: string;
    account?: string;
  };
  url?: string;
  raw?: unknown; // Original event data
}

export type CalendarSourceType = 'google' | 'apple' | 'ical' | 'web';

export interface CalendarSourceBase {
  type: CalendarSourceType;
  label: string;
  enabled?: boolean;
}

export interface GoogleCalendarSource extends CalendarSourceBase {
  type: 'google';
  account: string;
  calendarId?: string; // defaults to 'primary'
}

export interface AppleCalendarSource extends CalendarSourceBase {
  type: 'apple';
  calendars?: string[]; // specific calendar names, or all if empty
}

export interface ICalCalendarSource extends CalendarSourceBase {
  type: 'ical';
  url: string;
  refreshInterval?: string; // e.g., '1h', '24h'
}

export interface WebCalendarSource extends CalendarSourceBase {
  type: 'web';
  url: string;
  parser?: 'auto' | 'bandzoogle' | 'eventbrite' | 'custom';
  refreshInterval?: string;
  selectors?: WebSelectors; // CSS selectors for custom parsing
  calendarId?: string; // For Bandzoogle calendars: e.g., "1083094"
  monthsAhead?: number; // How many months ahead to fetch (default: 2)
}

export interface WebSelectors {
  eventContainer?: string;
  title?: string;
  date?: string;
  time?: string;
  location?: string;
  link?: string;
}

export type CalendarSource =
  | GoogleCalendarSource
  | AppleCalendarSource
  | ICalCalendarSource
  | WebCalendarSource;

export interface CalendarConfig {
  sources: CalendarSource[];
  defaults?: {
    days?: number;
    refreshInterval?: string;
  };
}

export interface CalendarAdapter {
  type: CalendarSourceType;
  getEvents(source: CalendarSource, startDate: Date, endDate: Date): Promise<UnifiedEvent[]>;
}
