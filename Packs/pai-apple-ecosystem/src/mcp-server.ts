#!/usr/bin/env bun
/**
 * PAI Apple Ecosystem MCP Server
 * Exposes Apple Calendar, Reminders, Contacts, and Notes as MCP tools
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Import all modules
import * as calendar from "./calendar/index.js";
import * as reminders from "./reminders/index.js";
import * as contacts from "./contacts/index.js";
import * as notes from "./notes/index.js";

const server = new Server(
  {
    name: "pai-apple-ecosystem",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define all tools
const tools: Tool[] = [
  // Calendar Tools
  {
    name: "apple_calendar_list",
    description: "List all Apple Calendar calendars",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "apple_calendar_today",
    description: "Get today's calendar events",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Optional: Filter by calendar name",
        },
      },
      required: [],
    },
  },
  {
    name: "apple_calendar_week",
    description: "Get this week's calendar events",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Optional: Filter by calendar name",
        },
      },
      required: [],
    },
  },
  {
    name: "apple_calendar_events",
    description: "Get calendar events within a date range",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date in ISO format (e.g., 2025-01-01)",
        },
        endDate: {
          type: "string",
          description: "End date in ISO format (e.g., 2025-01-31)",
        },
        calendar: {
          type: "string",
          description: "Optional: Filter by calendar name",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "apple_calendar_search",
    description: "Search calendar events by title, location, or notes",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        daysAhead: {
          type: "number",
          description: "Number of days ahead to search (default: 30)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "apple_calendar_create",
    description: "Create a new calendar event",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Event title",
        },
        startDate: {
          type: "string",
          description: "Start date/time in ISO format",
        },
        endDate: {
          type: "string",
          description: "End date/time in ISO format",
        },
        calendar: {
          type: "string",
          description: "Calendar name (default: Calendar)",
        },
        location: {
          type: "string",
          description: "Event location",
        },
        notes: {
          type: "string",
          description: "Event notes/description",
        },
        isAllDay: {
          type: "boolean",
          description: "Whether this is an all-day event",
        },
      },
      required: ["title", "startDate", "endDate"],
    },
  },

  // Reminders Tools
  {
    name: "apple_reminders_lists",
    description: "List all Apple Reminders lists",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "apple_reminders_all",
    description: "Get all reminders from all lists",
    inputSchema: {
      type: "object",
      properties: {
        listName: {
          type: "string",
          description: "Optional: Filter by list name",
        },
        includeCompleted: {
          type: "boolean",
          description: "Include completed reminders (default: false)",
        },
      },
      required: [],
    },
  },
  {
    name: "apple_reminders_today",
    description: "Get reminders due today",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "apple_reminders_overdue",
    description: "Get overdue reminders",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "apple_reminders_search",
    description: "Search reminders by name or body",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        includeCompleted: {
          type: "boolean",
          description: "Include completed reminders (default: false)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "apple_reminders_create",
    description: "Create a new reminder",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Reminder name",
        },
        listName: {
          type: "string",
          description: "List name (default: Reminders)",
        },
        body: {
          type: "string",
          description: "Reminder body/notes",
        },
        dueDate: {
          type: "string",
          description: "Due date in ISO format",
        },
        priority: {
          type: "number",
          description: "Priority (0=none, 1-4=low, 5=medium, 6-9=high)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "apple_reminders_complete",
    description: "Mark a reminder as complete",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Reminder name to complete",
        },
      },
      required: ["name"],
    },
  },

  // Contacts Tools
  {
    name: "apple_contacts_groups",
    description: "List all contact groups",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "apple_contacts_search",
    description: "Search contacts by name, email, or organization",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "apple_contacts_get",
    description: "Get a specific contact by name",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Contact name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "apple_contacts_group",
    description: "Get contacts from a specific group",
    inputSchema: {
      type: "object",
      properties: {
        groupName: {
          type: "string",
          description: "Group name",
        },
      },
      required: ["groupName"],
    },
  },
  {
    name: "apple_contacts_birthdays",
    description: "Get contacts with upcoming birthdays",
    inputSchema: {
      type: "object",
      properties: {
        daysAhead: {
          type: "number",
          description: "Number of days ahead to check (default: 30)",
        },
      },
      required: [],
    },
  },

  // Notes Tools
  {
    name: "apple_notes_folders",
    description: "List all Apple Notes folders",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "apple_notes_list",
    description: "List notes from a folder (or all notes)",
    inputSchema: {
      type: "object",
      properties: {
        folderName: {
          type: "string",
          description: "Optional: Filter by folder name",
        },
        limit: {
          type: "number",
          description: "Maximum number of notes to return (default: 50)",
        },
      },
      required: [],
    },
  },
  {
    name: "apple_notes_get",
    description: "Get a specific note by name",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Note name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "apple_notes_search",
    description: "Search notes by content",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "apple_notes_create",
    description: "Create a new note",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Note title",
        },
        body: {
          type: "string",
          description: "Note content",
        },
        folderName: {
          type: "string",
          description: "Folder name (default: Notes)",
        },
      },
      required: ["name", "body"],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    switch (name) {
      // Calendar
      case "apple_calendar_list":
        result = await calendar.listCalendars();
        break;
      case "apple_calendar_today":
        result = await calendar.getTodayEvents(args?.calendar as string);
        break;
      case "apple_calendar_week":
        result = await calendar.getWeekEvents(args?.calendar as string);
        break;
      case "apple_calendar_events":
        result = await calendar.getEvents(
          new Date(args!.startDate as string),
          new Date(args!.endDate as string),
          args?.calendar as string
        );
        break;
      case "apple_calendar_search":
        result = await calendar.searchEvents(
          args!.query as string,
          (args?.daysAhead as number) || 30
        );
        break;
      case "apple_calendar_create":
        result = await calendar.createEvent({
          title: args!.title as string,
          startDate: new Date(args!.startDate as string),
          endDate: new Date(args!.endDate as string),
          calendar: args?.calendar as string,
          location: args?.location as string,
          notes: args?.notes as string,
          isAllDay: args?.isAllDay as boolean,
        });
        break;

      // Reminders
      case "apple_reminders_lists":
        result = await reminders.listReminderLists();
        break;
      case "apple_reminders_all":
        result = await reminders.getReminders({
          listName: args?.listName as string,
          includeCompleted: args?.includeCompleted as boolean,
        });
        break;
      case "apple_reminders_today":
        result = await reminders.getTodayReminders();
        break;
      case "apple_reminders_overdue":
        result = await reminders.getOverdueReminders();
        break;
      case "apple_reminders_search":
        result = await reminders.searchReminders(
          args!.query as string,
          args?.includeCompleted as boolean
        );
        break;
      case "apple_reminders_create":
        result = await reminders.createReminder({
          name: args!.name as string,
          listName: args?.listName as string,
          body: args?.body as string,
          dueDate: args?.dueDate ? new Date(args.dueDate as string) : undefined,
          priority: args?.priority as number,
        });
        break;
      case "apple_reminders_complete":
        result = await reminders.completeReminder(args!.name as string);
        break;

      // Contacts
      case "apple_contacts_groups":
        result = await contacts.listGroups();
        break;
      case "apple_contacts_search":
        result = await contacts.searchContacts(args!.query as string);
        break;
      case "apple_contacts_get":
        result = await contacts.getContact(args!.name as string);
        break;
      case "apple_contacts_group":
        result = await contacts.getGroupContacts(args!.groupName as string);
        break;
      case "apple_contacts_birthdays":
        result = await contacts.getUpcomingBirthdays(
          (args?.daysAhead as number) || 30
        );
        break;

      // Notes
      case "apple_notes_folders":
        result = await notes.listFolders();
        break;
      case "apple_notes_list":
        result = await notes.getNotes({
          folderName: args?.folderName as string,
          limit: (args?.limit as number) || 50,
        });
        break;
      case "apple_notes_get":
        result = await notes.getNote(args!.name as string);
        break;
      case "apple_notes_search":
        result = await notes.searchNotes(
          args!.query as string,
          (args?.limit as number) || 20
        );
        break;
      case "apple_notes_create":
        result = await notes.createNote({
          name: args!.name as string,
          body: args!.body as string,
          folderName: args?.folderName as string,
        });
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PAI Apple Ecosystem MCP server started");
}

main().catch(console.error);
