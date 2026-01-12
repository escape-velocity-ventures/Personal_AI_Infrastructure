/**
 * Apple Reminders Integration
 * Uses AppleScript to interact with Reminders.app
 */

import { runAppleScriptMultiline } from "../applescript.js";

export interface Reminder {
  id: string;
  name: string;
  body?: string;
  completed: boolean;
  dueDate?: string;
  priority: number;
  list: string;
}

export interface ReminderList {
  name: string;
  id: string;
  count: number;
}

/**
 * List all reminder lists
 */
export async function listReminderLists(): Promise<ReminderList[]> {
  const script = `
set q to ASCII character 34
set output to "["
tell application "Reminders"
  set listCount to count of lists
  repeat with i from 1 to listCount
    set reminderList to list i
    set listName to name of reminderList
    set reminderCount to count of reminders of reminderList
    if i > 1 then set output to output & ","
    set output to output & "{" & q & "name" & q & ":" & q & listName & q & "," & q & "id" & q & ":" & q & listName & q & "," & q & "count" & q & ":" & reminderCount & "}"
  end repeat
end tell
set output to output & "]"
return output
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to list reminder lists");
  }

  return JSON.parse(result.data);
}

/**
 * Get all reminders (optionally from a specific list)
 */
export async function getReminders(params?: {
  listName?: string;
  includeCompleted?: boolean;
}): Promise<Reminder[]> {
  const { listName, includeCompleted = false } = params || {};

  const listFilter = listName
    ? `set targetLists to {list "${listName}"}`
    : `set targetLists to every list`;

  const script = `
set q to ASCII character 34
set output to "["
set reminderCount to 0
set includeCompleted to ${includeCompleted}

tell application "Reminders"
  ${listFilter}
  repeat with reminderList in targetLists
    set listName to name of reminderList
    set reminders_ to every reminder of reminderList
    repeat with r in reminders_
      try
        set isCompleted to completed of r
        if not includeCompleted and isCompleted then
          -- skip
        else
          set rName to my cleanStr(name of r)
          set rBody to ""
          try
            set rBody to my cleanStr(body of r)
          end try
          set rPriority to priority of r
          set rDueDate to ""
          try
            set dd to due date of r
            if dd is not missing value then
              set rDueDate to dd as string
            end if
          end try

          if reminderCount > 0 then set output to output & ","
          set output to output & "{"
          set output to output & q & "id" & q & ":" & q & "rem-" & reminderCount & q & ","
          set output to output & q & "name" & q & ":" & q & rName & q & ","
          set output to output & q & "body" & q & ":" & q & rBody & q & ","
          set output to output & q & "completed" & q & ":" & isCompleted & ","
          set output to output & q & "dueDate" & q & ":" & q & rDueDate & q & ","
          set output to output & q & "priority" & q & ":" & rPriority & ","
          set output to output & q & "list" & q & ":" & q & listName & q
          set output to output & "}"
          set reminderCount to reminderCount + 1
        end if
      end try
    end repeat
  end repeat
end tell
set output to output & "]"
return output

on cleanStr(str)
  if str is missing value then return ""
  set str to str as string
  set AppleScript's text item delimiters to ASCII character 34
  set parts to text items of str
  set AppleScript's text item delimiters to "'"
  set str to parts as string
  set AppleScript's text item delimiters to return
  set parts to text items of str
  set AppleScript's text item delimiters to " "
  set str to parts as string
  set AppleScript's text item delimiters to ASCII character 10
  set parts to text items of str
  set AppleScript's text item delimiters to " "
  set str to parts as string
  set AppleScript's text item delimiters to ""
  return str
end cleanStr
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get reminders");
  }

  return JSON.parse(result.data);
}

/**
 * Get reminders due today
 */
export async function getTodayReminders(): Promise<Reminder[]> {
  const script = `
set q to ASCII character 34
set output to "["
set reminderCount to 0
set todayStart to current date
set hours of todayStart to 0
set minutes of todayStart to 0
set seconds of todayStart to 0
set todayEnd to todayStart + (24 * 60 * 60)

tell application "Reminders"
  repeat with reminderList in every list
    set listName to name of reminderList
    repeat with r in every reminder of reminderList
      try
        if not completed of r then
          set dd to due date of r
          if dd is not missing value and dd >= todayStart and dd < todayEnd then
            set rName to my cleanStr(name of r)
            set rBody to ""
            try
              set rBody to my cleanStr(body of r)
            end try

            if reminderCount > 0 then set output to output & ","
            set output to output & "{"
            set output to output & q & "id" & q & ":" & q & "rem-" & reminderCount & q & ","
            set output to output & q & "name" & q & ":" & q & rName & q & ","
            set output to output & q & "body" & q & ":" & q & rBody & q & ","
            set output to output & q & "completed" & q & ":false,"
            set output to output & q & "dueDate" & q & ":" & q & (dd as string) & q & ","
            set output to output & q & "priority" & q & ":" & (priority of r) & ","
            set output to output & q & "list" & q & ":" & q & listName & q
            set output to output & "}"
            set reminderCount to reminderCount + 1
          end if
        end if
      end try
    end repeat
  end repeat
end tell
set output to output & "]"
return output

on cleanStr(str)
  if str is missing value then return ""
  set str to str as string
  set AppleScript's text item delimiters to ASCII character 34
  set parts to text items of str
  set AppleScript's text item delimiters to "'"
  set str to parts as string
  set AppleScript's text item delimiters to return
  set parts to text items of str
  set AppleScript's text item delimiters to " "
  set str to parts as string
  set AppleScript's text item delimiters to ""
  return str
end cleanStr
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get today's reminders");
  }

  return JSON.parse(result.data);
}

/**
 * Get overdue reminders
 */
export async function getOverdueReminders(): Promise<Reminder[]> {
  const script = `
set q to ASCII character 34
set output to "["
set reminderCount to 0
set now to current date

tell application "Reminders"
  repeat with reminderList in every list
    set listName to name of reminderList
    repeat with r in every reminder of reminderList
      try
        if not completed of r then
          set dd to due date of r
          if dd is not missing value and dd < now then
            set rName to my cleanStr(name of r)

            if reminderCount > 0 then set output to output & ","
            set output to output & "{"
            set output to output & q & "id" & q & ":" & q & "rem-" & reminderCount & q & ","
            set output to output & q & "name" & q & ":" & q & rName & q & ","
            set output to output & q & "completed" & q & ":false,"
            set output to output & q & "dueDate" & q & ":" & q & (dd as string) & q & ","
            set output to output & q & "priority" & q & ":" & (priority of r) & ","
            set output to output & q & "list" & q & ":" & q & listName & q
            set output to output & "}"
            set reminderCount to reminderCount + 1
          end if
        end if
      end try
    end repeat
  end repeat
end tell
set output to output & "]"
return output

on cleanStr(str)
  if str is missing value then return ""
  set str to str as string
  set AppleScript's text item delimiters to ASCII character 34
  set parts to text items of str
  set AppleScript's text item delimiters to "'"
  set str to parts as string
  set AppleScript's text item delimiters to ""
  return str
end cleanStr
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get overdue reminders");
  }

  return JSON.parse(result.data);
}

/**
 * Create a new reminder
 */
export async function createReminder(params: {
  name: string;
  listName?: string;
  body?: string;
  dueDate?: Date;
  priority?: number;
}): Promise<Reminder> {
  const {
    name,
    listName = "Reminders",
    body = "",
    dueDate,
    priority = 0,
  } = params;

  const escapedName = name.replace(/"/g, "'");
  const escapedBody = body.replace(/"/g, "'");

  let dueDateScript = "";
  if (dueDate) {
    const dateStr = dueDate.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    dueDateScript = `, due date:date "${dateStr}"`;
  }

  const script = `
set q to ASCII character 34
tell application "Reminders"
  set targetList to list "${listName}"
  set newReminder to make new reminder at end of targetList with properties {name:"${escapedName}", body:"${escapedBody}", priority:${priority}${dueDateScript}}

  set rName to name of newReminder
  set rBody to ""
  try
    set rBody to body of newReminder
  end try
  set rDueDate to ""
  try
    set dd to due date of newReminder
    if dd is not missing value then set rDueDate to dd as string
  end try

  return "{" & q & "id" & q & ":" & q & "new" & q & "," & q & "name" & q & ":" & q & rName & q & "," & q & "body" & q & ":" & q & rBody & q & "," & q & "completed" & q & ":false," & q & "dueDate" & q & ":" & q & rDueDate & q & "," & q & "priority" & q & ":" & (priority of newReminder) & "," & q & "list" & q & ":" & q & "${listName}" & q & "}"
end tell
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to create reminder");
  }

  return JSON.parse(result.data);
}

/**
 * Complete a reminder by name
 */
export async function completeReminder(reminderName: string): Promise<boolean> {
  const escapedName = reminderName.replace(/"/g, "'").toLowerCase();

  const script = `
set found to false
tell application "Reminders"
  repeat with reminderList in every list
    repeat with r in every reminder of reminderList
      try
        if not completed of r then
          set rName to name of r
          if (rName as string) is "${escapedName}" then
            set completed of r to true
            set found to true
            exit repeat
          end if
        end if
      end try
    end repeat
    if found then exit repeat
  end repeat
end tell
return found
  `;

  const result = await runAppleScriptMultiline(script);
  return result.success && result.data === "true";
}

/**
 * Search reminders by name
 */
export async function searchReminders(
  query: string,
  includeCompleted: boolean = false
): Promise<Reminder[]> {
  const allReminders = await getReminders({ includeCompleted });
  const lowerQuery = query.toLowerCase();
  return allReminders.filter(
    (r) =>
      r.name?.toLowerCase().includes(lowerQuery) ||
      r.body?.toLowerCase().includes(lowerQuery)
  );
}

// CLI interface for testing
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "lists":
        const lists = await listReminderLists();
        console.log("Reminder Lists:", JSON.stringify(lists, null, 2));
        break;

      case "all":
        const allReminders = await getReminders({
          includeCompleted: args.includes("--completed"),
        });
        console.log("All Reminders:", JSON.stringify(allReminders, null, 2));
        break;

      case "today":
        const todayReminders = await getTodayReminders();
        console.log("Today's Reminders:", JSON.stringify(todayReminders, null, 2));
        break;

      case "overdue":
        const overdueReminders = await getOverdueReminders();
        console.log("Overdue Reminders:", JSON.stringify(overdueReminders, null, 2));
        break;

      case "search":
        const query = args[1] || "";
        const results = await searchReminders(query, args.includes("--completed"));
        console.log(`Search Results for "${query}":`, JSON.stringify(results, null, 2));
        break;

      case "create":
        const name = args[1] || "New Reminder";
        const newReminder = await createReminder({ name });
        console.log("Created Reminder:", JSON.stringify(newReminder, null, 2));
        break;

      case "complete":
        const reminderName = args[1] || "";
        const completed = await completeReminder(reminderName);
        console.log(completed ? "Reminder completed" : "Reminder not found");
        break;

      default:
        console.log("Usage: bun run src/reminders/index.ts <command>");
        console.log(
          "Commands: lists, all, today, overdue, search <query>, create <name>, complete <name>"
        );
        console.log("Flags: --completed (include completed reminders)");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
