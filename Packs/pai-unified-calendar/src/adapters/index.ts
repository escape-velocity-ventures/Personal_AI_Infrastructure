import type {
  CalendarAdapter,
  CalendarSource,
  UnifiedEvent,
  CalendarConfig,
} from '../types';
import { googleAdapter } from './google';
import { appleAdapter } from './apple';
import { icalAdapter } from './ical';
import { webAdapter } from './web';

// Registry of all adapters
const adapters: Record<string, CalendarAdapter> = {
  google: googleAdapter,
  apple: appleAdapter,
  ical: icalAdapter,
  web: webAdapter,
};

export function getAdapter(type: string): CalendarAdapter | undefined {
  return adapters[type];
}

export interface FetchOptions {
  days?: number;
  startDate?: Date;
  endDate?: Date;
  parallel?: boolean;
}

/**
 * Fetch events from a single source
 */
export async function fetchEventsFromSource(
  source: CalendarSource,
  options: FetchOptions = {}
): Promise<UnifiedEvent[]> {
  const adapter = getAdapter(source.type);
  if (!adapter) {
    console.warn(`No adapter found for source type: ${source.type}`);
    return [];
  }

  const now = new Date();
  const startDate = options.startDate || now;
  const endDate =
    options.endDate ||
    new Date(now.getTime() + (options.days || 7) * 24 * 60 * 60 * 1000);

  try {
    return await adapter.getEvents(source, startDate, endDate);
  } catch (error) {
    console.error(`Error fetching from ${source.label}:`, error);
    return [];
  }
}

/**
 * Fetch events from all configured sources
 */
export async function fetchAllEvents(
  config: CalendarConfig,
  options: FetchOptions = {}
): Promise<UnifiedEvent[]> {
  const enabledSources = config.sources.filter((s) => s.enabled !== false);

  if (enabledSources.length === 0) {
    return [];
  }

  const days = options.days || config.defaults?.days || 7;
  const fetchOptions = { ...options, days };

  // Fetch from all sources in parallel by default
  const results = await Promise.allSettled(
    enabledSources.map((source) => fetchEventsFromSource(source, fetchOptions))
  );

  // Collect successful results
  const allEvents: UnifiedEvent[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    } else {
      console.error(`Failed to fetch from ${enabledSources[index].label}:`, result.reason);
    }
  });

  // Sort by start date
  return allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Fetch events grouped by source
 */
export async function fetchEventsBySource(
  config: CalendarConfig,
  options: FetchOptions = {}
): Promise<Map<string, UnifiedEvent[]>> {
  const enabledSources = config.sources.filter((s) => s.enabled !== false);
  const days = options.days || config.defaults?.days || 7;
  const fetchOptions = { ...options, days };

  const resultMap = new Map<string, UnifiedEvent[]>();

  const results = await Promise.allSettled(
    enabledSources.map(async (source) => ({
      label: source.label,
      events: await fetchEventsFromSource(source, fetchOptions),
    }))
  );

  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      resultMap.set(result.value.label, result.value.events);
    }
  });

  return resultMap;
}

export { googleAdapter, appleAdapter, icalAdapter, webAdapter };
