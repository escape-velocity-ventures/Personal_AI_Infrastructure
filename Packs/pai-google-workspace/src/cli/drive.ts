#!/usr/bin/env bun
import { drive } from "../lib/google-client";

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

async function main() {
  switch (command) {
    case "list": {
      const parsed = parseArgs(args);
      const folderId = parsed.folder;
      const maxResults = parseInt(parsed.max || "20", 10);

      console.log(folderId ? `Files in folder: ${folderId}\n` : "Recent files:\n");

      const files = await drive.listFiles(folderId, maxResults);

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
        console.error("Usage: bun run drive search <query>");
        process.exit(1);
      }

      console.log(`Searching for: "${query}"\n`);

      const files = await drive.search(query);

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
        console.error("Usage: bun run drive get <fileId>");
        process.exit(1);
      }

      const file = await drive.getFile(fileId);
      console.log(JSON.stringify(file, null, 2));
      break;
    }

    case "read": {
      const fileId = args[0];

      if (!fileId) {
        console.error("Usage: bun run drive read <fileId>");
        process.exit(1);
      }

      const content = await drive.readContent(fileId);
      console.log(content);
      break;
    }

    default:
      console.log("Usage: bun run drive <command> [options]");
      console.log("");
      console.log("Commands:");
      console.log("  list [--folder ID] [--max N]  List files");
      console.log("  search <query>                Search files");
      console.log("  get <fileId>                  Get file metadata");
      console.log("  read <fileId>                 Read file content");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
