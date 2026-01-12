/**
 * Apple Calendar Integration
 * Uses AppleScript to interact with Calendar.app
 */

import { runAppleScriptMultiline } from "../applescript.js";

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  calendar: string;
  isAllDay: boolean;
  url?: string;
}

export interface Calendar {
  name: string;
  id: string;
}

/**
 * List all calendars
 */
export async function listCalendars(): Promise<Calendar[]> {
  const script = `
set output to "["
tell application "Calendar"
  set calList to every calendar
  repeat with i from 1 to count of calList
    set cal to item i of calList
    set calName to name of cal
    if i > 1 then set output to output & ","
    set output to output & "{\\"name\\":\\"" & calName & "\\",\\"id\\":\\"" & calName & "\\"}"
  end repeat
end tell
set output to output & "]"
return output
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to list calendars");
  }

  return JSON.parse(result.data);
}

/**
 * Get events within a date range
 */
export async function getEvents(
  startDate: Date,
  endDate: Date,
  calendarName?: string
): Promise<CalendarEvent[]> {
  const startStr = startDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const endStr = endDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const calFilter = calendarName
    ? `set calList to {calendar "${calendarName}"}`
    : `set calList to every calendar`;

  const script = `
set q to ASCII character 34
set output to "["
set eventCount to 0
set startD to date "${startStr}"
set endD to date "${endStr}"

tell application "Calendar"
  ${calFilter}
  repeat with cal in calList
    set calName to name of cal
    try
      set evtList to (every event of cal whose start date >= startD and start date <= endD)
      repeat with evt in evtList
        try
          set evtTitle to summary of evt
          set evtStart to start date of evt
          set evtEnd to end date of evt
          set evtLoc to ""
          set evtNotes to ""
          set evtAllDay to allday event of evt

          try
            set evtLoc to location of evt
          end try
          try
            set evtNotes to description of evt
          end try

          -- Clean strings
          set evtTitle to my cleanStr(evtTitle)
          set evtLoc to my cleanStr(evtLoc)
          set evtNotes to my cleanStr(evtNotes)

          if eventCount > 0 then set output to output & ","
          set output to output & "{"
          set output to output & q & "id" & q & ":" & q & "evt-" & eventCount & q & ","
          set output to output & q & "title" & q & ":" & q & evtTitle & q & ","
          set output to output & q & "startDate" & q & ":" & q & (evtStart as string) & q & ","
          set output to output & q & "endDate" & q & ":" & q & (evtEnd as string) & q & ","
          set output to output & q & "location" & q & ":" & q & evtLoc & q & ","
          set output to output & q & "notes" & q & ":" & q & evtNotes & q & ","
          set output to output & q & "calendar" & q & ":" & q & calName & q & ","
          set output to output & q & "isAllDay" & q & ":" & evtAllDay
          set output to output & "}"
          set eventCount to eventCount + 1
        end try
      end repeat
    end try
  end repeat
end tell

set output to output & "]"
return output

on cleanStr(str)
  if str is missing value then return ""
  set str to str as string
  -- Replace quotes with single quotes
  set AppleScript's text item delimiters to ASCII character 34
  set parts to text items of str
  set AppleScript's text item delimiters to "'"
  set str to parts as string
  -- Replace returns with space
  set AppleScript's text item delimiters to return
  set parts to text items of str
  set AppleScript's text item delimiters to " "
  set str to parts as string
  -- Replace line feeds with space
  set AppleScript's text item delimiters to ASCII character 10
  set parts to text items of str
  set AppleScript's text item delimiters to " "
  set str to parts as string
  -- Replace backslashes
  set AppleScript's text item delimiters to "\\\\"
  set parts to text items of str
  set AppleScript's text item delimiters to "/"
  set str to parts as string
  set AppleScript's text item delimiters to ""
  return str
end cleanStr
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get events");
  }

  try {
    const events = JSON.parse(result.data);
    // Sort by start date
    return events.sort(
      (a: CalendarEvent, b: CalendarEvent) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
  } catch (e) {
    console.error("Parse error:", result.data);
    throw new Error("Failed to parse calendar events");
  }
}

/**
 * Get today's events
 */
export async function getTodayEvents(calendarName?: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  return getEvents(startOfDay, endOfDay, calendarName);
}

/**
 * Get this week's events
 */
export async function getWeekEvents(calendarName?: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return getEvents(startOfWeek, endOfWeek, calendarName);
}

/**
 * Create a new calendar event
 */
export async function createEvent(params: {
  title: string;
  startDate: Date;
  endDate: Date;
  calendar?: string;
  location?: string;
  notes?: string;
  isAllDay?: boolean;
}): Promise<CalendarEvent> {
  const {
    title,
    startDate,
    endDate,
    calendar = "Calendar",
    location = "",
    notes = "",
    isAllDay = false,
  } = params;

  const startStr = startDate.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const endStr = endDate.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedLocation = location.replace(/"/g, '\\"');
  const escapedNotes = notes.replace(/"/g, '\\"');

  const script = `
    tell application "Calendar"
      set targetCal to first calendar whose name is "${calendar}"
      set startD to date "${startStr}"
      set endD to date "${endStr}"

      set newEvent to make new event at end of events of targetCal with properties {summary:"${escapedTitle}", start date:startD, end date:endD, location:"${escapedLocation}", description:"${escapedNotes}", allday event:${isAllDay}}

      set evtId to uid of newEvent
      set evtStart to start date of newEvent
      set evtEnd to end date of newEvent

      return "{\\"id\\":\\"" & evtId & "\\",\\"title\\":\\"${escapedTitle}\\",\\"startDate\\":\\"" & (evtStart as «class isot» as string) & "\\",\\"endDate\\":\\"" & (evtEnd as «class isot» as string) & "\\",\\"location\\":\\"${escapedLocation}\\",\\"notes\\":\\"${escapedNotes}\\",\\"calendar\\":\\"${calendar}\\",\\"isAllDay\\":${isAllDay}}"
    end tell
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to create event");
  }

  return JSON.parse(result.data);
}

/**
 * Search events by title
 */
export async function searchEvents(
  query: string,
  daysAhead: number = 30
): Promise<CalendarEvent[]> {
  const now = new Date();
  const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days back
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const events = await getEvents(startDate, endDate);

  const lowerQuery = query.toLowerCase();
  return events.filter(
    (evt) =>
      evt.title?.toLowerCase().includes(lowerQuery) ||
      evt.location?.toLowerCase().includes(lowerQuery) ||
      evt.notes?.toLowerCase().includes(lowerQuery)
  );
}

// CLI interface for testing
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "calendars":
        const calendars = await listCalendars();
        console.log("Calendars:", JSON.stringify(calendars, null, 2));
        break;

      case "today":
        const todayEvents = await getTodayEvents();
        console.log("Today's Events:", JSON.stringify(todayEvents, null, 2));
        break;

      case "week":
        const weekEvents = await getWeekEvents();
        console.log("This Week's Events:", JSON.stringify(weekEvents, null, 2));
        break;

      case "search":
        const query = args[1] || "";
        const results = await searchEvents(query);
        console.log(`Search Results for "${query}":`, JSON.stringify(results, null, 2));
        break;

      default:
        console.log("Usage: bun run src/calendar/index.ts <command>");
        console.log("Commands: calendars, today, week, search <query>");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
