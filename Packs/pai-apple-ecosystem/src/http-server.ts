#!/usr/bin/env bun
/**
 * PAI Apple Ecosystem HTTP Server
 *
 * Exposes Apple MCP tools over HTTP for K8s cluster access.
 * Runs on Mac Mini nodes and serves Calendar, Reminders, Contacts, Notes tools.
 * Also handles Apple Health data ingestion from Health Auto Export app.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';

// Import all modules
import * as calendar from './calendar/index.js';
import * as reminders from './reminders/index.js';
import * as contacts from './contacts/index.js';
import * as notes from './notes/index.js';

// Health data configuration
const TELOS_METRICS_PATH = process.env.TELOS_METRICS_PATH ||
  join(dirname(dirname(dirname(import.meta.path))), 'pai-telos-metrics', 'data', 'metrics.jsonl');

const TELOS_CONFIG_PATH = process.env.TELOS_CONFIG_PATH ||
  join(dirname(dirname(dirname(import.meta.path))), 'pai-telos-metrics', 'data', 'kpi-config.yaml');

// Map Health Auto Export metric names to our KPI IDs
const HEALTH_METRIC_MAP: Record<string, { kpiId: string; goalRef: string | null }> = {
  'step_count': { kpiId: 'steps_count', goalRef: 'G3' },
  'step count': { kpiId: 'steps_count', goalRef: 'G3' },
  'steps': { kpiId: 'steps_count', goalRef: 'G3' },
  'exercise_time': { kpiId: 'exercise_minutes', goalRef: 'G3' },
  'exercise time': { kpiId: 'exercise_minutes', goalRef: 'G3' },
  'apple_exercise_time': { kpiId: 'exercise_minutes', goalRef: 'G3' },
  'apple exercise time': { kpiId: 'exercise_minutes', goalRef: 'G3' },
  'sleep_analysis': { kpiId: 'sleep_hours', goalRef: null },
  'sleep analysis': { kpiId: 'sleep_hours', goalRef: null },
  'sleep': { kpiId: 'sleep_hours', goalRef: null },
};

interface HealthMetricData {
  qty?: number;
  value?: number;
  totalSleep?: number;
  date: string;
}

interface HealthMetric {
  name: string;
  units: string;
  data: HealthMetricData[];
}

interface HealthAutoExportPayload {
  data: {
    metrics?: HealthMetric[];
    workouts?: unknown[];
  };
}

interface MetricEntry {
  timestamp: string;
  kpi_id: string;
  value: number;
  goal_ref: string | null;
  source: string;
  note?: string;
}

const app = new Hono();

// Enable CORS for internal cluster access
app.use('*', cors());

// ============================================================================
// Health Data Ingestion (from Health Auto Export app)
// ============================================================================

/**
 * Load existing metrics to check for duplicates
 */
function loadExistingMetrics(): MetricEntry[] {
  if (!existsSync(TELOS_METRICS_PATH)) {
    return [];
  }
  const content = readFileSync(TELOS_METRICS_PATH, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as MetricEntry);
}

/**
 * Check if a metric already exists for given date, KPI, and source
 */
function metricExists(metrics: MetricEntry[], date: string, kpiId: string): boolean {
  return metrics.some(
    (m) => m.timestamp.startsWith(date) && m.kpi_id === kpiId && m.source === 'health_auto_export'
  );
}

/**
 * Parse date from Health Auto Export format
 * Format: "2025-01-15 10:30:00 +0000" or "2025-01-15"
 */
function parseHealthDate(dateStr: string): string {
  // Extract just the date portion (YYYY-MM-DD)
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : dateStr.split(' ')[0];
}

/**
 * Extract value from Health Auto Export data point
 */
function extractValue(dataPoint: HealthMetricData, metricName: string): number | null {
  // Sleep uses totalSleep field
  if (metricName.toLowerCase().includes('sleep')) {
    return dataPoint.totalSleep ?? dataPoint.qty ?? dataPoint.value ?? null;
  }
  // Other metrics use qty or value
  return dataPoint.qty ?? dataPoint.value ?? null;
}

/**
 * POST /health/ingest
 * Receives health data from Health Auto Export app
 */
app.post('/health/ingest', async (c) => {
  try {
    const payload = await c.req.json() as HealthAutoExportPayload;

    if (!payload.data?.metrics || !Array.isArray(payload.data.metrics)) {
      return c.json({ error: 'Invalid payload: expected data.metrics array' }, 400);
    }

    // Ensure metrics directory exists
    const metricsDir = dirname(TELOS_METRICS_PATH);
    if (!existsSync(metricsDir)) {
      mkdirSync(metricsDir, { recursive: true });
    }

    const existingMetrics = loadExistingMetrics();
    const results: { imported: number; skipped: number; errors: string[] } = {
      imported: 0,
      skipped: 0,
      errors: [],
    };

    for (const metric of payload.data.metrics) {
      const metricNameLower = metric.name.toLowerCase().replace(/-/g, '_');
      const mapping = HEALTH_METRIC_MAP[metricNameLower];

      if (!mapping) {
        // Skip unknown metrics silently (Health Auto Export sends many)
        continue;
      }

      for (const dataPoint of metric.data) {
        const date = parseHealthDate(dataPoint.date);
        const value = extractValue(dataPoint, metric.name);

        if (value === null) {
          results.errors.push(`No value found for ${metric.name} on ${date}`);
          continue;
        }

        // Check for existing entry
        if (metricExists(existingMetrics, date, mapping.kpiId)) {
          results.skipped++;
          continue;
        }

        // Create metric entry
        const entry: MetricEntry = {
          timestamp: `${date}T12:00:00.000Z`,
          kpi_id: mapping.kpiId,
          value,
          goal_ref: mapping.goalRef,
          source: 'health_auto_export',
        };

        // Append to metrics file
        appendFileSync(TELOS_METRICS_PATH, JSON.stringify(entry) + '\n');
        results.imported++;

        // Add to existing metrics for duplicate detection within same request
        existingMetrics.push(entry);
      }
    }

    console.log(`[Health Ingest] Imported: ${results.imported}, Skipped: ${results.skipped}`);

    return c.json({
      status: 'ok',
      imported: results.imported,
      skipped: results.skipped,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Health Ingest] Error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /health/ingest/status
 * Shows health ingestion configuration status
 */
app.get('/health/ingest/status', (c) => {
  const metricsExists = existsSync(TELOS_METRICS_PATH);
  const configExists = existsSync(TELOS_CONFIG_PATH);

  let lastHealthEntry: MetricEntry | null = null;
  if (metricsExists) {
    const metrics = loadExistingMetrics();
    const healthMetrics = metrics
      .filter((m) => m.source === 'health_auto_export')
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    lastHealthEntry = healthMetrics[0] || null;
  }

  return c.json({
    status: 'configured',
    metricsPath: TELOS_METRICS_PATH,
    metricsFileExists: metricsExists,
    configFileExists: configExists,
    lastHealthEntry,
    supportedMetrics: Object.keys(HEALTH_METRIC_MAP),
  });
});

// ============================================================================
// Apple MCP Tools
// ============================================================================

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
console.log(`  GET  /health              - Health check`);
console.log(`  GET  /tools               - List available tools`);
console.log(`  POST /call                - Call a tool`);
console.log(`  POST /health/ingest       - Receive Apple Health data`);
console.log(`  GET  /health/ingest/status - Health ingestion status`);
console.log('');
console.log(`Metrics path: ${TELOS_METRICS_PATH}`);

export default {
  port,
  fetch: app.fetch,
};
