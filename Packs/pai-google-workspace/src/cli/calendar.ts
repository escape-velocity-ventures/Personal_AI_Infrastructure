#!/usr/bin/env bun
import { calendar, forAccount, type Notify } from "../lib/google-client";

// Flags that take no value.
const BOOLEAN_FLAGS = new Set(["meet"]);

const command = process.argv[2];
const args = process.argv.slice(3);

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        result[key] = "true";
        continue;
      }
      const value = args[i + 1] || "";
      result[key] = value;
      i++;
    }
  }
  return result;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function getCalendarClient(account?: string) {
  return account ? forAccount(account).calendar : calendar;
}

async function main() {
  const parsed = parseArgs(args);
  const account = parsed.account;
  const cal = getCalendarClient(account);

  switch (command) {
    case "list": {
      const days = parseInt(parsed.days || "7", 10);
      const calendarId = parsed.calendar || "primary";

      console.log(`Upcoming events (next ${days} days):\n`);

      const events = await cal.listEvents(calendarId, days);

      if (events.length === 0) {
        console.log("No upcoming events.");
        return;
      }

      for (const event of events) {
        const start = event.start.dateTime || event.start.date;
        const end = event.end.dateTime || event.end.date;

        console.log(`${event.summary || "(No title)"}`);
        console.log(`  ID: ${event.id}`);
        console.log(`  Start: ${formatDate(start)}`);
        console.log(`  End: ${formatDate(end)}`);
        if (event.location) {
          console.log(`  Location: ${event.location}`);
        }
        console.log("");
      }
      break;
    }

    case "get": {
      const eventId = args[0];

      if (!eventId) {
        console.error("Usage: bun run calendar get <eventId> [--account EMAIL]");
        process.exit(1);
      }

      const event = await cal.getEvent(eventId);
      console.log(JSON.stringify(event, null, 2));
      break;
    }

    case "create": {
      const { title, start, end, description, location, attendees, notify, timezone, calendar: calendarId } = parsed;

      if (!title || !start || !end) {
        console.error("Usage: bun run calendar create --title <title> --start <iso8601> --end <iso8601>");
        console.error("         [--description <desc>] [--description-file <path>] [--location <loc>]");
        console.error("         [--attendees <a@x.com,b@y.com> --notify all|externalOnly|none]");
        console.error("         [--meet] [--timezone <IANA>] [--calendar <id>] [--account EMAIL]");
        console.error("");
        console.error("--notify is required with --attendees: 'all' emails them an invite from the account,");
        console.error("so --notify all/externalOnly also requires --account.");
        console.error("");
        console.error("Example:");
        console.error('  bun run calendar create --title "Team Meeting" --start "2024-01-15T10:00:00-08:00" --end "2024-01-15T11:00:00-08:00" \\');
        console.error('    --attendees pat@example.com --notify all --meet');
        process.exit(1);
      }

      const descriptionFile = parsed["description-file"];
      const event = await cal.createEvent(title, start, end, {
        description: descriptionFile ? await Bun.file(descriptionFile).text() : description,
        location,
        attendees: attendees ? [attendees] : undefined,
        notify: notify as Notify | undefined,
        meet: parsed.meet === "true",
        timeZone: timezone,
        calendarId,
      });

      console.log("Event created!");
      console.log(`  ID: ${event.id}`);
      console.log(`  Start: ${event.start.dateTime || event.start.date}`);
      console.log(`  End: ${event.end.dateTime || event.end.date}`);
      if (event.attendees?.length) {
        console.log(`  Guests: ${event.attendees.map((a) => a.email).join(", ")} (invite email: ${notify})`);
      }
      if (event.hangoutLink) console.log(`  Meet: ${event.hangoutLink}`);
      if (event.htmlLink) console.log(`  Link: ${event.htmlLink}`);
      break;
    }

    case "freebusy": {
      const { start, end } = parsed;

      if (!start || !end) {
        console.error("Usage: bun run calendar freebusy --start <iso8601> --end <iso8601> [--account EMAIL]");
        process.exit(1);
      }

      const result = await cal.freeBusy(start, end);
      console.log("Free/Busy Status:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.log("Usage: bun run calendar <command> [options]");
      console.log("");
      console.log("Global Options:");
      console.log("  --account EMAIL            Use specific Google account");
      console.log("");
      console.log("Commands:");
      console.log("  list [--days N] [--calendar ID]  List upcoming events");
      console.log("  get <eventId>                    Get event details");
      console.log("  create --title --start --end     Create an event (--attendees, --notify, --meet, --timezone)");
      console.log("  freebusy --start --end           Check availability");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
