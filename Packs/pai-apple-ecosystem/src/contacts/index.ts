/**
 * Apple Contacts Integration
 * Uses AppleScript to interact with Contacts.app
 * Read-only for safety - no modification operations
 */

import { runAppleScriptMultiline } from "../applescript.js";

export interface Contact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  organization?: string;
  jobTitle?: string;
  emails: Array<{ label: string; value: string }>;
  phones: Array<{ label: string; value: string }>;
}

export interface ContactGroup {
  name: string;
  id: string;
  count: number;
}

/**
 * List all contact groups
 */
export async function listGroups(): Promise<ContactGroup[]> {
  const script = `
set q to ASCII character 34
set output to "["
tell application "Contacts"
  set groupList to every group
  repeat with i from 1 to count of groupList
    set g to item i of groupList
    set gName to name of g
    set gCount to count of people of g
    if i > 1 then set output to output & ","
    set output to output & "{" & q & "name" & q & ":" & q & gName & q & "," & q & "id" & q & ":" & q & gName & q & "," & q & "count" & q & ":" & gCount & "}"
  end repeat
end tell
set output to output & "]"
return output
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to list contact groups");
  }

  return JSON.parse(result.data);
}

/**
 * Search contacts by name or email
 */
export async function searchContacts(query: string): Promise<Contact[]> {
  const escapedQuery = query.toLowerCase().replace(/"/g, "'");

  const script = `
set q to ASCII character 34
set output to "["
set contactCount to 0
set searchQuery to "${escapedQuery}"

tell application "Contacts"
  repeat with p in every person
    try
      set firstName to ""
      set lastName to ""
      set fullName to ""
      set org to ""
      set jobTitle to ""

      try
        set firstName to first name of p
      end try
      try
        set lastName to last name of p
      end try
      try
        set org to organization of p
      end try
      try
        set jobTitle to job title of p
      end try

      if firstName is missing value then set firstName to ""
      if lastName is missing value then set lastName to ""
      if org is missing value then set org to ""
      if jobTitle is missing value then set jobTitle to ""

      set fullName to firstName & " " & lastName
      set fullName to my trim(fullName)
      if fullName is "" then set fullName to org

      set matched to false

      -- Check name
      if (my toLowerCase(fullName)) contains searchQuery then set matched to true
      if (my toLowerCase(org)) contains searchQuery then set matched to true

      -- Check emails
      set emailList to "["
      set emailCount to 0
      repeat with e in every email of p
        try
          set emailVal to value of e
          set emailLabel to label of e
          if emailLabel is missing value then set emailLabel to "email"
          if emailVal is missing value then set emailVal to ""

          if (my toLowerCase(emailVal)) contains searchQuery then set matched to true

          if emailCount > 0 then set emailList to emailList & ","
          set emailList to emailList & "{" & q & "label" & q & ":" & q & emailLabel & q & "," & q & "value" & q & ":" & q & emailVal & q & "}"
          set emailCount to emailCount + 1
        end try
      end repeat
      set emailList to emailList & "]"

      if matched then
        -- Get phones
        set phoneList to "["
        set phoneCount to 0
        repeat with ph in every phone of p
          try
            set phoneVal to value of ph
            set phoneLabel to label of ph
            if phoneLabel is missing value then set phoneLabel to "phone"
            if phoneVal is missing value then set phoneVal to ""

            if phoneCount > 0 then set phoneList to phoneList & ","
            set phoneList to phoneList & "{" & q & "label" & q & ":" & q & phoneLabel & q & "," & q & "value" & q & ":" & q & phoneVal & q & "}"
            set phoneCount to phoneCount + 1
          end try
        end repeat
        set phoneList to phoneList & "]"

        if contactCount > 0 then set output to output & ","
        set output to output & "{"
        set output to output & q & "id" & q & ":" & q & "contact-" & contactCount & q & ","
        set output to output & q & "firstName" & q & ":" & q & firstName & q & ","
        set output to output & q & "lastName" & q & ":" & q & lastName & q & ","
        set output to output & q & "fullName" & q & ":" & q & fullName & q & ","
        set output to output & q & "organization" & q & ":" & q & org & q & ","
        set output to output & q & "jobTitle" & q & ":" & q & jobTitle & q & ","
        set output to output & q & "emails" & q & ":" & emailList & ","
        set output to output & q & "phones" & q & ":" & phoneList
        set output to output & "}"
        set contactCount to contactCount + 1
      end if
    end try
  end repeat
end tell

set output to output & "]"
return output

on trim(str)
  if str is "" then return ""
  set str to str as string
  repeat while str begins with " "
    set str to text 2 thru -1 of str
  end repeat
  repeat while str ends with " "
    set str to text 1 thru -2 of str
  end repeat
  return str
end trim

on toLowerCase(str)
  if str is missing value then return ""
  set str to str as string
  set lowercaseChars to "abcdefghijklmnopqrstuvwxyz"
  set uppercaseChars to "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  set result to ""
  repeat with c in str
    set c to c as string
    set idx to offset of c in uppercaseChars
    if idx > 0 then
      set result to result & character idx of lowercaseChars
    else
      set result to result & c
    end if
  end repeat
  return result
end toLowerCase
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to search contacts");
  }

  return JSON.parse(result.data);
}

/**
 * Get a specific contact by name
 */
export async function getContact(name: string): Promise<Contact | null> {
  const results = await searchContacts(name);
  const lowerName = name.toLowerCase();

  // Try exact match first
  const exactMatch = results.find(
    (c) => c.fullName?.toLowerCase() === lowerName
  );
  if (exactMatch) return exactMatch;

  // Return first partial match
  return results[0] || null;
}

/**
 * Get contacts from a specific group
 */
export async function getGroupContacts(groupName: string): Promise<Contact[]> {
  const script = `
set q to ASCII character 34
set output to "["
set contactCount to 0

tell application "Contacts"
  try
    set targetGroup to group "${groupName}"
    repeat with p in every person of targetGroup
      try
        set firstName to ""
        set lastName to ""
        set org to ""

        try
          set firstName to first name of p
        end try
        try
          set lastName to last name of p
        end try
        try
          set org to organization of p
        end try

        if firstName is missing value then set firstName to ""
        if lastName is missing value then set lastName to ""
        if org is missing value then set org to ""

        set fullName to firstName & " " & lastName
        set fullName to my trim(fullName)
        if fullName is "" then set fullName to org

        -- Get emails
        set emailList to "["
        set emailCount to 0
        repeat with e in every email of p
          try
            set emailVal to value of e
            set emailLabel to label of e
            if emailLabel is missing value then set emailLabel to "email"
            if emailVal is missing value then set emailVal to ""

            if emailCount > 0 then set emailList to emailList & ","
            set emailList to emailList & "{" & q & "label" & q & ":" & q & emailLabel & q & "," & q & "value" & q & ":" & q & emailVal & q & "}"
            set emailCount to emailCount + 1
          end try
        end repeat
        set emailList to emailList & "]"

        -- Get phones
        set phoneList to "["
        set phoneCount to 0
        repeat with ph in every phone of p
          try
            set phoneVal to value of ph
            set phoneLabel to label of ph
            if phoneLabel is missing value then set phoneLabel to "phone"
            if phoneVal is missing value then set phoneVal to ""

            if phoneCount > 0 then set phoneList to phoneList & ","
            set phoneList to phoneList & "{" & q & "label" & q & ":" & q & phoneLabel & q & "," & q & "value" & q & ":" & q & phoneVal & q & "}"
            set phoneCount to phoneCount + 1
          end try
        end repeat
        set phoneList to phoneList & "]"

        if contactCount > 0 then set output to output & ","
        set output to output & "{"
        set output to output & q & "id" & q & ":" & q & "contact-" & contactCount & q & ","
        set output to output & q & "firstName" & q & ":" & q & firstName & q & ","
        set output to output & q & "lastName" & q & ":" & q & lastName & q & ","
        set output to output & q & "fullName" & q & ":" & q & fullName & q & ","
        set output to output & q & "organization" & q & ":" & q & org & q & ","
        set output to output & q & "emails" & q & ":" & emailList & ","
        set output to output & q & "phones" & q & ":" & phoneList
        set output to output & "}"
        set contactCount to contactCount + 1
      end try
    end repeat
  end try
end tell

set output to output & "]"
return output

on trim(str)
  if str is "" then return ""
  set str to str as string
  repeat while str begins with " "
    set str to text 2 thru -1 of str
  end repeat
  repeat while str ends with " "
    set str to text 1 thru -2 of str
  end repeat
  return str
end trim
  `;

  const result = await runAppleScriptMultiline(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get group contacts");
  }

  return JSON.parse(result.data);
}

/**
 * Get contacts with upcoming birthdays (stub - requires more complex date handling)
 */
export async function getUpcomingBirthdays(daysAhead: number = 30): Promise<Contact[]> {
  // Birthday handling in AppleScript is complex - returning empty for now
  return [];
}

// CLI interface for testing
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "groups":
        const groups = await listGroups();
        console.log("Contact Groups:", JSON.stringify(groups, null, 2));
        break;

      case "search":
        const query = args[1] || "";
        const results = await searchContacts(query);
        console.log(`Search Results for "${query}":`, JSON.stringify(results, null, 2));
        break;

      case "get":
        const name = args[1] || "";
        const contact = await getContact(name);
        console.log("Contact:", JSON.stringify(contact, null, 2));
        break;

      case "group":
        const groupName = args[1] || "";
        const groupContacts = await getGroupContacts(groupName);
        console.log(`Contacts in "${groupName}":`, JSON.stringify(groupContacts, null, 2));
        break;

      default:
        console.log("Usage: bun run src/contacts/index.ts <command>");
        console.log("Commands: groups, search <query>, get <name>, group <groupName>");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
