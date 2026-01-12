import { loadConfig } from '../config/loader';
import { fetchAllEvents, fetchEventsBySource } from '../adapters';
import type { UnifiedEvent } from '../types';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

function formatEventForOutput(event: UnifiedEvent) {
  return {
    id: event.id,
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    allDay: event.allDay,
    location: event.location,
    description: event.description,
    source: event.source.label,
    sourceType: event.source.type,
    url: event.url,
  };
}

export const unifiedCalendarTools: ToolDefinition[] = [
  {
    name: 'unified_calendar_list',
    description:
      'List all upcoming events from all configured calendar sources (Google, Apple, iCal feeds, web calendars)',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look ahead (default: 7)',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter by source labels (e.g., ["Work", "Personal"]). If empty, returns all sources.',
        },
      },
    },
  },
  {
    name: 'unified_calendar_today',
    description: "Get today's events from all configured calendar sources",
    inputSchema: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by source labels',
        },
      },
    },
  },
  {
    name: 'unified_calendar_by_source',
    description: 'Get events grouped by calendar source',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look ahead (default: 7)',
        },
      },
    },
  },
  {
    name: 'unified_calendar_sources',
    description: 'List all configured calendar sources',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleUnifiedCalendarTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const config = loadConfig();

  switch (name) {
    case 'unified_calendar_list': {
      const days = (args.days as number) || 7;
      const sourceFilter = args.sources as string[] | undefined;

      let filteredConfig = config;
      if (sourceFilter && sourceFilter.length > 0) {
        filteredConfig = {
          ...config,
          sources: config.sources.filter((s) => sourceFilter.includes(s.label)),
        };
      }

      const events = await fetchAllEvents(filteredConfig, { days });
      return {
        count: events.length,
        days,
        sources: filteredConfig.sources.map((s) => s.label),
        events: events.map(formatEventForOutput),
      };
    }

    case 'unified_calendar_today': {
      const sourceFilter = args.sources as string[] | undefined;
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      let filteredConfig = config;
      if (sourceFilter && sourceFilter.length > 0) {
        filteredConfig = {
          ...config,
          sources: config.sources.filter((s) => sourceFilter.includes(s.label)),
        };
      }

      const events = await fetchAllEvents(filteredConfig, {
        startDate: startOfDay,
        endDate: endOfDay,
      });

      return {
        date: startOfDay.toISOString().split('T')[0],
        count: events.length,
        events: events.map(formatEventForOutput),
      };
    }

    case 'unified_calendar_by_source': {
      const days = (args.days as number) || 7;
      const eventsBySource = await fetchEventsBySource(config, { days });

      const result: Record<string, { count: number; events: unknown[] }> = {};
      for (const [label, events] of eventsBySource) {
        result[label] = {
          count: events.length,
          events: events.map(formatEventForOutput),
        };
      }

      return {
        days,
        sources: result,
      };
    }

    case 'unified_calendar_sources': {
      return {
        count: config.sources.length,
        sources: config.sources.map((s) => ({
          label: s.label,
          type: s.type,
          enabled: s.enabled !== false,
          ...('account' in s ? { account: s.account } : {}),
          ...('url' in s ? { url: s.url } : {}),
        })),
      };
    }

    default:
      throw new Error(`Unknown unified calendar tool: ${name}`);
  }
}
