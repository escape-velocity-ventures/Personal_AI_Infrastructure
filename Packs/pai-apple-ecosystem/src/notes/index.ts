/**
 * Apple Notes Integration
 * Uses JavaScript for Automation (JXA) to interact with Notes.app
 */

import { runJXA } from "../applescript.js";

export interface Note {
  id: string;
  name: string;
  body: string;
  plaintext: string;
  creationDate: string;
  modificationDate: string;
  folder: string;
  account: string;
}

export interface NotesFolder {
  name: string;
  id: string;
  account: string;
  noteCount: number;
}

export interface NotesAccount {
  name: string;
  id: string;
}

/**
 * List all notes accounts (iCloud, On My Mac, etc.)
 */
export async function listAccounts(): Promise<NotesAccount[]> {
  const script = `
    const app = Application("Notes");
    const accounts = app.accounts();
    const result = accounts.map(acc => ({
      name: acc.name(),
      id: acc.id(),
    }));
    JSON.stringify(result);
  `;

  const result = await runJXA(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to list accounts");
  }

  return JSON.parse(result.data);
}

/**
 * List all folders across all accounts
 */
export async function listFolders(): Promise<NotesFolder[]> {
  const script = `
    const app = Application("Notes");
    const folders = [];

    for (const account of app.accounts()) {
      try {
        for (const folder of account.folders()) {
          try {
            folders.push({
              name: folder.name(),
              id: folder.id(),
              account: account.name(),
              noteCount: folder.notes().length,
            });
          } catch (e) {}
        }
      } catch (e) {}
    }

    JSON.stringify(folders);
  `;

  const result = await runJXA(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to list folders");
  }

  return JSON.parse(result.data);
}

/**
 * Get notes from a specific folder (or all notes if no folder specified)
 */
export async function getNotes(params?: {
  folderName?: string;
  limit?: number;
}): Promise<Note[]> {
  const { folderName, limit = 50 } = params || {};

  const script = `
    const app = Application("Notes");
    const folderFilter = ${folderName ? `"${folderName}"` : "null"};
    const limit = ${limit};

    const notes = [];
    for (const account of app.accounts()) {
      if (notes.length >= limit) break;

      try {
        let folders = account.folders();
        if (folderFilter) {
          folders = folders.filter(f => f.name() === folderFilter);
        }

        for (const folder of folders) {
          if (notes.length >= limit) break;

          try {
            for (const note of folder.notes()) {
              if (notes.length >= limit) break;

              try {
                // Get body - Notes returns HTML-like content
                const body = note.body() || "";
                // Strip HTML tags for plaintext version
                const plaintext = body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

                notes.push({
                  id: note.id(),
                  name: note.name(),
                  body: body,
                  plaintext: plaintext.substring(0, 500) + (plaintext.length > 500 ? "..." : ""),
                  creationDate: note.creationDate().toISOString(),
                  modificationDate: note.modificationDate().toISOString(),
                  folder: folder.name(),
                  account: account.name(),
                });
              } catch (e) {}
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // Sort by modification date, newest first
    notes.sort((a, b) => new Date(b.modificationDate) - new Date(a.modificationDate));
    JSON.stringify(notes);
  `;

  const result = await runJXA(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get notes");
  }

  return JSON.parse(result.data);
}

/**
 * Get a specific note by name
 */
export async function getNote(noteName: string): Promise<Note | null> {
  const script = `
    const app = Application("Notes");
    const searchName = "${noteName.toLowerCase().replace(/"/g, '\\"')}";

    let foundNote = null;
    for (const account of app.accounts()) {
      if (foundNote) break;

      try {
        for (const folder of account.folders()) {
          if (foundNote) break;

          try {
            for (const note of folder.notes()) {
              try {
                if (note.name().toLowerCase() === searchName) {
                  const body = note.body() || "";
                  const plaintext = body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

                  foundNote = {
                    id: note.id(),
                    name: note.name(),
                    body: body,
                    plaintext: plaintext,
                    creationDate: note.creationDate().toISOString(),
                    modificationDate: note.modificationDate().toISOString(),
                    folder: folder.name(),
                    account: account.name(),
                  };
                  break;
                }
              } catch (e) {}
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    JSON.stringify(foundNote);
  `;

  const result = await runJXA(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get note");
  }

  const parsed = JSON.parse(result.data);
  return parsed === "null" || parsed === null ? null : parsed;
}

/**
 * Search notes by content
 */
export async function searchNotes(query: string, limit: number = 20): Promise<Note[]> {
  const script = `
    const app = Application("Notes");
    const query = "${query.toLowerCase().replace(/"/g, '\\"')}";
    const limit = ${limit};

    const notes = [];
    for (const account of app.accounts()) {
      if (notes.length >= limit) break;

      try {
        for (const folder of account.folders()) {
          if (notes.length >= limit) break;

          try {
            for (const note of folder.notes()) {
              if (notes.length >= limit) break;

              try {
                const name = note.name() || "";
                const body = note.body() || "";
                const plaintext = body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

                if (name.toLowerCase().includes(query) || plaintext.toLowerCase().includes(query)) {
                  notes.push({
                    id: note.id(),
                    name: name,
                    body: body,
                    plaintext: plaintext.substring(0, 500) + (plaintext.length > 500 ? "..." : ""),
                    creationDate: note.creationDate().toISOString(),
                    modificationDate: note.modificationDate().toISOString(),
                    folder: folder.name(),
                    account: account.name(),
                  });
                }
              } catch (e) {}
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    notes.sort((a, b) => new Date(b.modificationDate) - new Date(a.modificationDate));
    JSON.stringify(notes);
  `;

  const result = await runJXA(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to search notes");
  }

  return JSON.parse(result.data);
}

/**
 * Create a new note
 */
export async function createNote(params: {
  name: string;
  body: string;
  folderName?: string;
}): Promise<Note> {
  const { name, body, folderName = "Notes" } = params;

  // Escape the body for JavaScript string
  const escapedBody = body
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");

  const script = `
    const app = Application("Notes");
    const folderName = "${folderName}";

    // Find the target folder
    let targetFolder = null;
    for (const account of app.accounts()) {
      try {
        const folder = account.folders.whose({ name: folderName })[0];
        if (folder) {
          targetFolder = folder;
          break;
        }
      } catch (e) {}
    }

    // Fall back to default folder if not found
    if (!targetFolder) {
      targetFolder = app.defaultAccount().defaultFolder();
    }

    // Create the note
    const note = app.Note({
      name: "${name.replace(/"/g, '\\"')}",
      body: "${escapedBody}",
    });

    targetFolder.notes.push(note);

    const resultBody = note.body() || "";
    const plaintext = resultBody.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

    JSON.stringify({
      id: note.id(),
      name: note.name(),
      body: resultBody,
      plaintext: plaintext.substring(0, 500),
      creationDate: note.creationDate().toISOString(),
      modificationDate: note.modificationDate().toISOString(),
      folder: targetFolder.name(),
      account: targetFolder.container().name(),
    });
  `;

  const result = await runJXA(script);
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to create note");
  }

  return JSON.parse(result.data);
}

// CLI interface for testing
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "accounts":
        const accounts = await listAccounts();
        console.log("Accounts:", JSON.stringify(accounts, null, 2));
        break;

      case "folders":
        const folders = await listFolders();
        console.log("Folders:", JSON.stringify(folders, null, 2));
        break;

      case "list":
        const folderName = args[1];
        const notes = await getNotes({ folderName, limit: 20 });
        console.log("Notes:", JSON.stringify(notes, null, 2));
        break;

      case "get":
        const noteName = args[1] || "";
        const note = await getNote(noteName);
        console.log("Note:", JSON.stringify(note, null, 2));
        break;

      case "search":
        const query = args[1] || "";
        const results = await searchNotes(query);
        console.log(`Search Results for "${query}":`, JSON.stringify(results, null, 2));
        break;

      case "create":
        const title = args[1] || "New Note";
        const body = args[2] || "Created from PAI";
        const newNote = await createNote({ name: title, body });
        console.log("Created Note:", JSON.stringify(newNote, null, 2));
        break;

      default:
        console.log("Usage: bun run src/notes/index.ts <command>");
        console.log("Commands: accounts, folders, list [folder], get <name>, search <query>, create <title> [body]");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
