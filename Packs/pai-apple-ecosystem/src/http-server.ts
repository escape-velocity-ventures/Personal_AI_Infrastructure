#!/usr/bin/env bun
/**
 * PAI Apple Ecosystem HTTP Server
 *
 * Exposes Apple MCP tools over HTTP for K8s cluster access.
 * Runs on Mac Mini nodes and serves Calendar, Reminders, Contacts, Notes tools.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Import all modules
import * as calendar from './calendar/index.js';
import * as reminders from './reminders/index.js';
import * as contacts from './contacts/index.js';
import * as notes from './notes/index.js';

const app = new Hono();

// Enable CORS for internal cluster access
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// List all available tools
app.get('/tools', (c) => {
  return c.json({
    tools: [
      // Calendar Tools
      { name: 'apple_calendar_list', description: 'List all Apple Calendar calendars' },
      { name: 'apple_calendar_today', description: "Get today's calendar events" },
      { name: 'apple_calendar_week', description: "Get this week's calendar events" },
      { name: 'apple_calendar_events', description: 'Get calendar events within a date range' },
      { name: 'apple_calendar_search', description: 'Search calendar events' },
      { name: 'apple_calendar_create', description: 'Create a new calendar event' },

      // Reminders Tools
      { name: 'apple_reminders_lists', description: 'List all Apple Reminders lists' },
      { name: 'apple_reminders_all', description: 'Get all reminders from all lists' },
      { name: 'apple_reminders_today', description: 'Get reminders due today' },
      { name: 'apple_reminders_overdue', description: 'Get overdue reminders' },
      { name: 'apple_reminders_search', description: 'Search reminders' },
      { name: 'apple_reminders_create', description: 'Create a new reminder' },
      { name: 'apple_reminders_complete', description: 'Mark a reminder as complete' },

      // Contacts Tools
      { name: 'apple_contacts_groups', description: 'List all contact groups' },
      { name: 'apple_contacts_search', description: 'Search contacts' },
      { name: 'apple_contacts_get', description: 'Get a specific contact by name' },
      { name: 'apple_contacts_group', description: 'Get contacts from a specific group' },
      { name: 'apple_contacts_birthdays', description: 'Get contacts with upcoming birthdays' },

      // Notes Tools
      { name: 'apple_notes_folders', description: 'List all Apple Notes folders' },
      { name: 'apple_notes_list', description: 'List notes from a folder' },
      { name: 'apple_notes_get', description: 'Get a specific note by name' },
      { name: 'apple_notes_search', description: 'Search notes by content' },
      { name: 'apple_notes_create', description: 'Create a new note' },
    ],
  });
});

// Call a tool
app.post('/call', async (c) => {
  try {
    const { name, arguments: args } = await c.req.json();

    if (!name) {
      return c.json({ error: 'Tool name is required' }, 400);
    }

    let result: unknown;

    switch (name) {
      // Calendar
      case 'apple_calendar_list':
        result = await calendar.listCalendars();
        break;
      case 'apple_calendar_today':
        result = await calendar.getTodayEvents(args?.calendar);
        break;
      case 'apple_calendar_week':
        result = await calendar.getWeekEvents(args?.calendar);
        break;
      case 'apple_calendar_events':
        result = await calendar.getEvents(
          new Date(args.startDate),
          new Date(args.endDate),
          args?.calendar
        );
        break;
      case 'apple_calendar_search':
        result = await calendar.searchEvents(args.query, args?.daysAhead || 30);
        break;
      case 'apple_calendar_create':
        result = await calendar.createEvent({
          title: args.title,
          startDate: new Date(args.startDate),
          endDate: new Date(args.endDate),
          calendar: args?.calendar,
          location: args?.location,
          notes: args?.notes,
          isAllDay: args?.isAllDay,
        });
        break;

      // Reminders
      case 'apple_reminders_lists':
        result = await reminders.listReminderLists();
        break;
      case 'apple_reminders_all':
        result = await reminders.getReminders({
          listName: args?.listName,
          includeCompleted: args?.includeCompleted,
        });
        break;
      case 'apple_reminders_today':
        result = await reminders.getTodayReminders();
        break;
      case 'apple_reminders_overdue':
        result = await reminders.getOverdueReminders();
        break;
      case 'apple_reminders_search':
        result = await reminders.searchReminders(args.query, args?.includeCompleted);
        break;
      case 'apple_reminders_create':
        result = await reminders.createReminder({
          name: args.name,
          listName: args?.listName,
          body: args?.body,
          dueDate: args?.dueDate ? new Date(args.dueDate) : undefined,
          priority: args?.priority,
        });
        break;
      case 'apple_reminders_complete':
        result = await reminders.completeReminder(args.name);
        break;

      // Contacts
      case 'apple_contacts_groups':
        result = await contacts.listGroups();
        break;
      case 'apple_contacts_search':
        result = await contacts.searchContacts(args.query);
        break;
      case 'apple_contacts_get':
        result = await contacts.getContact(args.name);
        break;
      case 'apple_contacts_group':
        result = await contacts.getGroupContacts(args.groupName);
        break;
      case 'apple_contacts_birthdays':
        result = await contacts.getUpcomingBirthdays(args?.daysAhead || 30);
        break;

      // Notes
      case 'apple_notes_folders':
        result = await notes.listFolders();
        break;
      case 'apple_notes_list':
        result = await notes.getNotes({
          folderName: args?.folderName,
          limit: args?.limit || 50,
        });
        break;
      case 'apple_notes_get':
        result = await notes.getNote(args.name);
        break;
      case 'apple_notes_search':
        result = await notes.searchNotes(args.query, args?.limit || 20);
        break;
      case 'apple_notes_create':
        result = await notes.createNote({
          name: args.name,
          body: args.body,
          folderName: args?.folderName,
        });
        break;

      default:
        return c.json({ error: `Unknown tool: ${name}` }, 400);
    }

    return c.json({ result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Tool call error:', message);
    return c.json({ error: message }, 500);
  }
});

// Start server
const port = parseInt(process.env.PORT || '8081');

console.log('╭─────────────────────────────────────╮');
console.log('│  PAI Apple MCP HTTP Server          │');
console.log('╰─────────────────────────────────────╯');
console.log('');
console.log(`Listening on port ${port}`);
console.log('');
console.log('Endpoints:');
console.log(`  GET  /health - Health check`);
console.log(`  GET  /tools  - List available tools`);
console.log(`  POST /call   - Call a tool`);

export default {
  port,
  fetch: app.fetch,
};
