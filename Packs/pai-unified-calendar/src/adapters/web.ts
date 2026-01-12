import type { CalendarAdapter, WebCalendarSource, UnifiedEvent, WebSelectors } from '../types';
import Anthropic from '@anthropic-ai/sdk';

interface ExtractedEvent {
  title: string;
  date?: string;
  time?: string;
  location?: string;
  url?: string;
  description?: string;
}

// Cache for web calendars
const cache = new Map<string, { data: UnifiedEvent[]; timestamp: number }>();

function parseRefreshInterval(interval: string): number {
  const match = interval?.match(/^(\d+)(h|m|d)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24 hours

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
      return 24 * 60 * 60 * 1000;
  }
}

// Fetch events from Bandzoogle calendar by fetching multiple months
async function fetchBandzoogleCalendar(
  baseUrl: string,
  calendarId: string,
  monthsAhead: number = 2
): Promise<ExtractedEvent[]> {
  const events: ExtractedEvent[] = [];
  const now = new Date();

  for (let i = 0; i <= monthsAhead; i++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;

    const url = `${new URL(baseUrl).origin}/go/calendar/${calendarId}/${year}/${month}`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });

      if (!response.ok) continue;

      const html = await response.text();

      // Bandzoogle calendar structure: <td> cells contain <div class="day">N</div> followed by events
      // Pattern: Find table cells with events (capturing the td tag to check for other-month)
      const cellPattern = /<td([^>]*)>[\s\S]*?<div[^>]*class="[^"]*day[^"]*"[^>]*>(\d{1,2})<\/div>([\s\S]*?)<\/td>/gi;

      let cellMatch;
      while ((cellMatch = cellPattern.exec(html)) !== null) {
        const tdAttrs = cellMatch[1];
        const dayNum = parseInt(cellMatch[2]);
        const cellContent = cellMatch[3];

        // Skip "other-month" cells (days from previous/next month)
        if (tdAttrs.includes('other-month')) continue;

        // Skip if this cell has no events
        if (!cellContent.includes('event-name')) continue;

        // Build date string
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

        // Find all events in this cell
        const eventPattern = /<span class="event-name[^"]*">([^<]+)<\/span>[\s\S]*?<br>\s*<span>([^<]*)<\/span>/gi;

        let eventMatch;
        while ((eventMatch = eventPattern.exec(cellContent)) !== null) {
          const title = eventMatch[1]
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .trim();
          const location = eventMatch[2].trim();

          // Try to find time - format: <span class="time"><span class="icon-clock"></span>10:00AM</span>
          const timeMatch = cellContent.match(/class="time"[^>]*>[\s\S]*?<\/span>(\d{1,2}:\d{2}(?:AM|PM)?)/i);
          const time = timeMatch ? timeMatch[1] : undefined;

          events.push({ title, date: dateStr, time, location });
        }
      }
    } catch (error) {
      console.error(`Failed to fetch Bandzoogle calendar month ${month}/${year}:`, error);
    }
  }

  return events;
}

// Detect Bandzoogle calendar ID from page HTML
function detectBandzoogleCalendarId(html: string): string | null {
  // Look for calendar ID in navigation links
  const match = html.match(/\/go\/calendar\/(\d+)\//);
  return match ? match[1] : null;
}

// Known parser patterns for common calendar platforms
const KNOWN_PARSERS: Record<string, (html: string) => ExtractedEvent[]> = {
  // Legacy bandgle parser (renamed to bandzoogle)
  bandgle: (html: string) => {
    const events: ExtractedEvent[] = [];
    // Look for event patterns in Bandgle format
    const eventRegex = /<div[^>]*class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const titleRegex = /<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/i;
    const dateRegex = /(\w+day,?\s+\w+\s+\d+,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i;
    const timeRegex = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i;
    const locationRegex = /<[^>]*class="[^"]*(?:location|venue)[^"]*"[^>]*>([^<]+)/i;

    let match;
    while ((match = eventRegex.exec(html)) !== null) {
      const eventHtml = match[1];
      const titleMatch = titleRegex.exec(eventHtml);
      const dateMatch = dateRegex.exec(eventHtml);
      const timeMatch = timeRegex.exec(eventHtml);
      const locationMatch = locationRegex.exec(eventHtml);

      if (titleMatch) {
        events.push({
          title: titleMatch[1].trim(),
          date: dateMatch?.[1],
          time: timeMatch?.[1],
          location: locationMatch?.[1]?.trim(),
        });
      }
    }
    return events;
  },

  // Generic event extractor - looks for common patterns
  auto: (html: string) => {
    const events: ExtractedEvent[] = [];

    // Try to find events in common formats
    // Look for schema.org Event markup
    const schemaRegex = /"@type"\s*:\s*"Event"[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*?"startDate"\s*:\s*"([^"]+)"/gi;
    let match;
    while ((match = schemaRegex.exec(html)) !== null) {
      events.push({
        title: match[1],
        date: match[2],
      });
    }

    // If no schema.org events, try common HTML patterns
    if (events.length === 0) {
      // Look for elements with event-like classes
      const eventBlockRegex =
        /<(?:div|article|li)[^>]*class="[^"]*(?:event|show|performance|gig)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|li)>/gi;

      while ((match = eventBlockRegex.exec(html)) !== null) {
        const block = match[1];
        // Extract title from headings or links
        const titleMatch = /<(?:h[1-6]|a)[^>]*>([^<]+)</i.exec(block);
        const dateMatch = /(\w+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(block);
        const timeMatch = /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i.exec(block);

        if (titleMatch) {
          events.push({
            title: titleMatch[1].trim(),
            date: dateMatch?.[1],
            time: timeMatch?.[1],
          });
        }
      }
    }

    return events;
  },
};

// Extract events using CSS selectors
function extractWithSelectors(html: string, selectors: WebSelectors): ExtractedEvent[] {
  // This is a simplified version - in production, use a proper DOM parser
  const events: ExtractedEvent[] = [];

  if (!selectors.eventContainer) return events;

  // Simple regex-based extraction (would use cheerio/jsdom in production)
  const containerRegex = new RegExp(
    `<[^>]*class="[^"]*${selectors.eventContainer}[^"]*"[^>]*>([\\s\\S]*?)<\\/`,
    'gi'
  );

  let match;
  while ((match = containerRegex.exec(html)) !== null) {
    const content = match[1];
    const event: ExtractedEvent = { title: '' };

    if (selectors.title) {
      const titleMatch = new RegExp(`class="[^"]*${selectors.title}[^"]*"[^>]*>([^<]+)`, 'i').exec(
        content
      );
      if (titleMatch) event.title = titleMatch[1].trim();
    }

    if (selectors.date) {
      const dateMatch = new RegExp(`class="[^"]*${selectors.date}[^"]*"[^>]*>([^<]+)`, 'i').exec(
        content
      );
      if (dateMatch) event.date = dateMatch[1].trim();
    }

    if (selectors.time) {
      const timeMatch = new RegExp(`class="[^"]*${selectors.time}[^"]*"[^>]*>([^<]+)`, 'i').exec(
        content
      );
      if (timeMatch) event.time = timeMatch[1].trim();
    }

    if (selectors.location) {
      const locMatch = new RegExp(`class="[^"]*${selectors.location}[^"]*"[^>]*>([^<]+)`, 'i').exec(
        content
      );
      if (locMatch) event.location = locMatch[1].trim();
    }

    if (event.title) events.push(event);
  }

  return events;
}

// Use Claude AI for extraction when other methods fail (for JS-rendered content)
async function extractWithAI(html: string, url: string): Promise<ExtractedEvent[]> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];

    const client = new Anthropic({ apiKey });

    // Find the event section by looking for event-related class names
    let relevantHtml = html;

    // Look for event content markers
    const eventMarkers = ['event-name', 'event_details', 'event-item', 'calendar-event'];
    let eventIndex = -1;

    for (const marker of eventMarkers) {
      const idx = html.indexOf(marker);
      if (idx > 0 && (eventIndex < 0 || idx < eventIndex)) {
        eventIndex = idx;
      }
    }

    if (eventIndex > 0) {
      // Extract 80KB window around event content
      const start = Math.max(0, eventIndex - 5000);
      const end = Math.min(html.length, eventIndex + 75000);
      relevantHtml = html.slice(start, end);
    }

    // Final truncation if still too large
    const truncatedHtml = relevantHtml.slice(0, 80000);

    // Get current date for context
    const today = new Date();
    const dateContext = today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `Today is ${dateContext}. Extract ALL events from this webpage HTML, including future events. For each event, identify:
- title: event name
- date: date string in YYYY-MM-DD format
- time: time string (e.g., "7:00 PM")
- location: venue name

Look for ALL events on the calendar, not just today's events. Parse the full calendar/schedule shown on the page.

Return ONLY a JSON array. Example:
[{"title": "Jazz Night", "date": "2026-01-15", "time": "7:00 PM", "location": "Blue Note"}]

If no events found, return: []

HTML:
${truncatedHtml}`,
        },
      ],
    });

    // Parse response
    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON from response - strip markdown code blocks if present
    const cleanedText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } catch (error) {
    console.error('AI extraction failed:', error);
    return [];
  }
}

function parseEventDate(dateStr?: string, timeStr?: string): { start: Date; end: Date } {
  let start = new Date();
  let end = new Date();

  if (dateStr) {
    // Handle YYYY-MM-DD format - parse as local time, not UTC
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      start = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    } else {
      // Try standard parsing for other formats
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        start = parsed;
        end = new Date(parsed.getTime() + 2 * 60 * 60 * 1000);
      }
    }
  }

  if (timeStr) {
    const timeMatch = /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/.exec(timeStr);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const meridiem = timeMatch[3]?.toUpperCase();

      if (meridiem === 'PM' && hours !== 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;

      start.setHours(hours, minutes, 0, 0);
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    }
  }

  return { start, end };
}

export const webAdapter: CalendarAdapter = {
  type: 'web',

  async getEvents(
    source: WebCalendarSource,
    startDate: Date,
    endDate: Date
  ): Promise<UnifiedEvent[]> {
    const cacheKey = source.url;
    const refreshMs = parseRefreshInterval(source.refreshInterval || '24h');
    const now = Date.now();

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < refreshMs) {
      return filterEventsByDateRange(cached.data, startDate, endDate);
    }

    // Fetch webpage
    const response = await fetch(source.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch web calendar: ${response.status}`);
    }

    const html = await response.text();
    let extractedEvents: ExtractedEvent[] = [];

    // Check for Bandzoogle calendar (auto-detect or use config)
    const bandzoogleId = source.calendarId || detectBandzoogleCalendarId(html);
    if (bandzoogleId && (source.parser === 'bandzoogle' || detectBandzoogleCalendarId(html))) {
      extractedEvents = await fetchBandzoogleCalendar(
        source.url,
        bandzoogleId,
        source.monthsAhead || 2
      );
    }

    // Try extraction methods in order of preference
    if (extractedEvents.length === 0 && source.selectors) {
      extractedEvents = extractWithSelectors(html, source.selectors);
    }

    if (extractedEvents.length === 0 && source.parser && KNOWN_PARSERS[source.parser]) {
      extractedEvents = KNOWN_PARSERS[source.parser](html);
    }

    if (extractedEvents.length === 0) {
      extractedEvents = KNOWN_PARSERS.auto(html);
    }

    // AI fallback for JS-rendered or complex pages
    if (extractedEvents.length === 0) {
      extractedEvents = await extractWithAI(html, source.url);
    }

    // Convert to unified events
    const events: UnifiedEvent[] = extractedEvents.map((event, index) => {
      const { start, end } = parseEventDate(event.date, event.time);

      return {
        id: `web:${source.label}:${index}:${event.title.slice(0, 20)}`,
        title: event.title,
        start,
        end,
        allDay: !event.time,
        location: event.location,
        description: event.description,
        source: {
          type: 'web' as const,
          label: source.label,
        },
        url: event.url || source.url,
        raw: event,
      };
    });

    // Update cache
    cache.set(cacheKey, { data: events, timestamp: now });

    return filterEventsByDateRange(events, startDate, endDate);
  },
};

function filterEventsByDateRange(
  events: UnifiedEvent[],
  startDate: Date,
  endDate: Date
): UnifiedEvent[] {
  return events
    .filter((event) => event.start <= endDate && event.end >= startDate)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
