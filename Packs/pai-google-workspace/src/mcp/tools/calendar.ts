import { calendar } from "../../lib/google-client";
import type { ToolDefinition } from "../types";

export const calendarTools: ToolDefinition[] = [
  {
    name: "calendar_list",
    description: "List upcoming calendar events",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look ahead (default: 7)",
        },
        calendarId: {
          type: "string",
          description: "Calendar ID (default: 'primary')",
        },
      },
    },
  },
  {
    name: "calendar_get",
    description: "Get details of a specific calendar event",
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The event ID",
        },
        calendarId: {
          type: "string",
          description: "Calendar ID (default: 'primary')",
        },
      },
      required: ["eventId"],
    },
  },
  {
    name: "calendar_create",
    description: "Create a new calendar event",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Event title",
        },
        start: {
          type: "string",
          description: "Start time in ISO 8601 format (e.g., '2024-01-15T10:00:00-08:00')",
        },
        end: {
          type: "string",
          description: "End time in ISO 8601 format",
        },
        description: {
          type: "string",
          description: "Event description (optional)",
        },
        location: {
          type: "string",
          description: "Event location (optional)",
        },
        calendarId: {
          type: "string",
          description: "Calendar ID (default: 'primary')",
        },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "calendar_freebusy",
    description: "Check free/busy status for a time range",
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "Start time in ISO 8601 format",
        },
        end: {
          type: "string",
          description: "End time in ISO 8601 format",
        },
        calendarIds: {
          type: "array",
          items: { type: "string" },
          description: "Calendar IDs to check (default: ['primary'])",
        },
      },
      required: ["start", "end"],
    },
  },
];

export async function handleCalendarTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "calendar_list": {
      const days = (args.days as number) || 7;
      const calendarId = (args.calendarId as string) || "primary";

      const events = await calendar.listEvents(calendarId, days);

      return events.map((event) => ({
        id: event.id,
        summary: event.summary,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        location: event.location,
      }));
    }

    case "calendar_get": {
      const eventId = args.eventId as string;
      const calendarId = (args.calendarId as string) || "primary";

      return calendar.getEvent(eventId, calendarId);
    }

    case "calendar_create": {
      const summary = args.summary as string;
      const start = args.start as string;
      const end = args.end as string;
      const description = args.description as string | undefined;
      const location = args.location as string | undefined;
      const calendarId = args.calendarId as string | undefined;

      const event = await calendar.createEvent(summary, start, end, {
        description,
        location,
        calendarId,
      });

      return event;
    }

    case "calendar_freebusy": {
      const start = args.start as string;
      const end = args.end as string;
      const calendarIds = (args.calendarIds as string[]) || ["primary"];

      const result = await calendar.freeBusy(start, end, calendarIds);

      // Transform to more readable format
      const busySlots: Record<string, { start: string; end: string }[]> = {};
      for (const [calId, data] of Object.entries(result.calendars)) {
        busySlots[calId] = data.busy;
      }

      return busySlots;
    }

    default:
      throw new Error(`Unknown Calendar tool: ${name}`);
  }
}
