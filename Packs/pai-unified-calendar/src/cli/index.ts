#!/usr/bin/env bun
import { loadConfig, getConfigPath } from '../config/loader';
import { fetchAllEvents, fetchEventsBySource } from '../adapters';
import type { UnifiedEvent } from '../types';

const command = process.argv[2];
const args = process.argv.slice(3);

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] || '';
      result[key] = value;
      i++;
    }
  }
  return result;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatEvent(event: UnifiedEvent): string {
  const dateStr = formatDate(event.start);
  const timeStr = event.allDay ? 'All day' : formatTime(event.start);
  const source = event.source.label;

  let output = `${event.title}\n`;
  output += `  ${dateStr} @ ${timeStr}\n`;
  output += `  Source: ${source}`;
  if (event.location) {
    output += `\n  Location: ${event.location}`;
  }
  return output;
}

function groupEventsByDate(events: UnifiedEvent[]): Map<string, UnifiedEvent[]> {
  const grouped = new Map<string, UnifiedEvent[]>();

  for (const event of events) {
    const dateKey = formatDate(event.start);
    const existing = grouped.get(dateKey) || [];
    existing.push(event);
    grouped.set(dateKey, existing);
  }

  return grouped;
}

async function main() {
  const parsed = parseArgs(args);
  const config = loadConfig();

  switch (command) {
    case 'list':
    case 'events': {
      const days = parseInt(parsed.days || '7', 10);
      const events = await fetchAllEvents(config, { days });

      if (events.length === 0) {
        console.log('No upcoming events found.');
        return;
      }

      console.log(`\n📅 All Events (next ${days} days)\n`);
      console.log('─'.repeat(50));

      const grouped = groupEventsByDate(events);
      for (const [date, dateEvents] of grouped) {
        console.log(`\n${date}`);
        console.log('─'.repeat(30));
        for (const event of dateEvents) {
          const timeStr = event.allDay ? 'All day' : formatTime(event.start);
          const source = `[${event.source.label}]`;
          console.log(`  ${timeStr.padEnd(10)} ${event.title} ${source}`);
          if (event.location) {
            console.log(`             📍 ${event.location}`);
          }
        }
      }

      console.log(`\n─────────────────────────────────────────────────`);
      console.log(`Total: ${events.length} events from ${config.sources.length} sources`);
      break;
    }

    case 'by-source': {
      const days = parseInt(parsed.days || '7', 10);
      const eventsBySource = await fetchEventsBySource(config, { days });

      console.log(`\n📅 Events by Source (next ${days} days)\n`);

      for (const [label, events] of eventsBySource) {
        console.log(`\n═══ ${label} (${events.length} events) ═══`);
        if (events.length === 0) {
          console.log('  No events');
          continue;
        }
        for (const event of events) {
          const dateStr = formatDate(event.start);
          const timeStr = event.allDay ? 'All day' : formatTime(event.start);
          console.log(`  ${dateStr} ${timeStr.padEnd(10)} ${event.title}`);
        }
      }
      break;
    }

    case 'sources': {
      console.log('\nConfigured Calendar Sources\n');
      console.log('─'.repeat(50));

      if (config.sources.length === 0) {
        console.log('No sources configured.');
        console.log(`\nCreate a config file at: ${getConfigPath() || '~/.claude/calendar-sources.yaml'}`);
        return;
      }

      for (const source of config.sources) {
        const status = source.enabled === false ? '(disabled)' : '(enabled)';
        console.log(`\n${source.label} ${status}`);
        console.log(`  Type: ${source.type}`);
        if ('account' in source) console.log(`  Account: ${source.account}`);
        if ('url' in source) console.log(`  URL: ${source.url}`);
        if ('calendars' in source && source.calendars)
          console.log(`  Calendars: ${source.calendars.join(', ')}`);
      }
      break;
    }

    case 'today': {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const events = await fetchAllEvents(config, { startDate: startOfDay, endDate: endOfDay });

      console.log(`\n📅 Today's Events (${formatDate(now)})\n`);
      console.log('─'.repeat(50));

      if (events.length === 0) {
        console.log('No events today.');
        return;
      }

      for (const event of events) {
        const timeStr = event.allDay ? 'All day' : formatTime(event.start);
        const source = `[${event.source.label}]`;
        console.log(`${timeStr.padEnd(10)} ${event.title} ${source}`);
        if (event.location) {
          console.log(`           📍 ${event.location}`);
        }
      }
      break;
    }

    case 'config': {
      const configPath = getConfigPath();
      if (configPath) {
        console.log(`Config file: ${configPath}`);
      } else {
        console.log('No config file found.');
        console.log('\nCreate one at: ~/.claude/calendar-sources.yaml');
        console.log('\nExample config:');
        console.log(`
sources:
  - type: google
    account: work@company.com
    label: Work

  - type: google
    account: personal@gmail.com
    label: Personal

  - type: apple
    label: Apple Calendar

  - type: ical
    url: https://example.com/calendar.ics
    label: Community

  - type: web
    url: https://venue.com/events
    label: Local Events
    parser: auto

defaults:
  days: 7
`);
      }
      break;
    }

    default:
      console.log('Unified Calendar - Aggregate all your calendars\n');
      console.log('Usage: bun run calendar <command> [options]\n');
      console.log('Commands:');
      console.log('  list [--days N]     List all events (default: 7 days)');
      console.log('  today               Show today\'s events');
      console.log('  by-source           List events grouped by source');
      console.log('  sources             Show configured calendar sources');
      console.log('  config              Show/create config file');
      break;
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
