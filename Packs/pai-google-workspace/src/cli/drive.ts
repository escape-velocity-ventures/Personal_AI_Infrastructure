#!/usr/bin/env bun
import { drive, docs, forAccount } from "../lib/google-client";

const command = process.argv[2];
const args = process.argv.slice(3);

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1] || "";
      result[key] = value;
      i++;
    }
  }
  return result;
}

function formatSize(bytes: string | undefined): string {
  if (!bytes) return "-";
  const size = parseInt(bytes, 10);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    "application/vnd.google-apps.folder": "Folder",
    "application/vnd.google-apps.document": "Doc",
    "application/vnd.google-apps.spreadsheet": "Sheet",
    "application/vnd.google-apps.presentation": "Slides",
    "application/pdf": "PDF",
    "text/plain": "Text",
    "image/jpeg": "Image",
    "image/png": "Image",
  };
  return mimeMap[mimeType] || mimeType.split("/").pop() || "File";
}

function getDriveClient(account?: string) {
  return account ? forAccount(account).drive : drive;
}

function getDocsClient(account?: string) {
  return account ? forAccount(account).docs : docs;
}

async function main() {
  const parsed = parseArgs(args);
  const account = parsed.account;
  const drv = getDriveClient(account);

  switch (command) {
    case "list": {
      const folderId = parsed.folder;
      const maxResults = parseInt(parsed.max || "20", 10);

      console.log(folderId ? `Files in folder: ${folderId}\n` : "Recent files:\n");

      const files = await drv.listFiles(folderId, maxResults);

      if (files.length === 0) {
        console.log("No files found.");
        return;
      }

      console.log("%-44s %-10s %-10s %s".replace(/%(-?\d*)s/g, (_, w) => `${"Name".padEnd(Math.abs(parseInt(w) || 0))}`));
      console.log("─".repeat(80));

      for (const file of files) {
        const type = formatMimeType(file.mimeType);
        const size = formatSize(file.size);
        const modified = new Date(file.modifiedTime).toLocaleDateString();
        console.log(`${file.name.slice(0, 40).padEnd(44)} ${type.padEnd(10)} ${size.padEnd(10)} ${modified}`);
        console.log(`  ID: ${file.id}`);
      }
      break;
    }

    case "search": {
      const query = args[0];

      if (!query) {
        console.error("Usage: bun run drive search <query> [--account EMAIL]");
        process.exit(1);
      }

      console.log(`Searching for: "${query}"\n`);

      const files = await drv.search(query);

      if (files.length === 0) {
        console.log("No files found.");
        return;
      }

      for (const file of files) {
        console.log(`${file.name}`);
        console.log(`  ID: ${file.id}`);
        console.log(`  Type: ${formatMimeType(file.mimeType)}`);
        console.log(`  Modified: ${new Date(file.modifiedTime).toLocaleString()}`);
        console.log("");
      }
      break;
    }

    case "get": {
      const fileId = args[0];

      if (!fileId) {
        console.error("Usage: bun run drive get <fileId> [--account EMAIL]");
        process.exit(1);
      }

      const file = await drv.getFile(fileId);
      console.log(JSON.stringify(file, null, 2));
      break;
    }

    case "read": {
      const fileId = args[0];

      if (!fileId) {
        console.error("Usage: bun run drive read <fileId> [--account EMAIL]");
        process.exit(1);
      }

      const content = await drv.readContent(fileId);
      console.log(content);
      break;
    }

    case "docs": {
      const docsClient = getDocsClient(account);
      const docsCommand = args[0];
      const docsArgs = args.slice(1);

      switch (docsCommand) {
        case "read": {
          const docId = docsArgs[0] || parsed.id;
          if (!docId) {
            console.error("Usage: bun run drive docs read <docId> [--account EMAIL]");
            process.exit(1);
          }

          const text = await docsClient.readAsText(docId);
          console.log(text);
          break;
        }

        case "get": {
          const docId = docsArgs[0] || parsed.id;
          if (!docId) {
            console.error("Usage: bun run drive docs get <docId> [--account EMAIL]");
            process.exit(1);
          }

          const doc = await docsClient.getDocument(docId);
          console.log(JSON.stringify(doc, null, 2));
          break;
        }

        case "append": {
          const docId = docsArgs[0] || parsed.id;
          const content = parsed.content;

          if (!docId || !content) {
            console.error("Usage: bun run drive docs append <docId> --content \"text to append\" [--account EMAIL]");
            process.exit(1);
          }

          await docsClient.append(docId, content);
          console.log("Content appended successfully.");
          break;
        }

        case "update": {
          const docId = docsArgs[0] || parsed.id;
          const content = parsed.content;

          if (!docId || !content) {
            console.error("Usage: bun run drive docs update <docId> --content \"new content\" [--account EMAIL]");
            process.exit(1);
          }

          await docsClient.replaceContent(docId, content);
          console.log("Document content replaced successfully.");
          break;
        }

        case "replace": {
          const docId = docsArgs[0] || parsed.id;
          const find = parsed.find;
          const replaceWith = parsed.replace;

          if (!docId || !find || replaceWith === undefined) {
            console.error("Usage: bun run drive docs replace <docId> --find \"text\" --replace \"replacement\" [--account EMAIL]");
            process.exit(1);
          }

          const result = await docsClient.findAndReplace(docId, find, replaceWith);
          console.log(`Replaced ${result.occurrencesChanged} occurrence(s).`);
          break;
        }

        default:
          console.log("Usage: bun run drive docs <command> [options]");
          console.log("");
          console.log("Commands:");
          console.log("  read <docId>                           Read document as plain text");
          console.log("  get <docId>                            Get document structure (JSON)");
          console.log("  append <docId> --content \"text\"        Append text to document");
          console.log("  update <docId> --content \"text\"        Replace all document content");
          console.log("  replace <docId> --find \"x\" --replace \"y\"  Find and replace text");
          console.log("");
          console.log("Options:");
          console.log("  --account EMAIL                        Use specific Google account");
          break;
      }
      break;
    }

    default:
      console.log("Usage: bun run drive <command> [options]");
      console.log("");
      console.log("Global Options:");
      console.log("  --account EMAIL           Use specific Google account");
      console.log("");
      console.log("Commands:");
      console.log("  list [--folder ID] [--max N]  List files");
      console.log("  search <query>                Search files");
      console.log("  get <fileId>                  Get file metadata");
      console.log("  read <fileId>                 Read file content");
      console.log("");
      console.log("  docs read <docId>             Read Google Doc as text");
      console.log("  docs get <docId>              Get Google Doc structure");
      console.log("  docs append <docId> --content Append to Google Doc");
      console.log("  docs update <docId> --content Replace Google Doc content");
      console.log("  docs replace <docId> --find --replace  Find and replace");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
