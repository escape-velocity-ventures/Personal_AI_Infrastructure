import { drive } from "../../lib/google-client";
import type { ToolDefinition } from "../types";

export const driveTools: ToolDefinition[] = [
  {
    name: "drive_list",
    description: "List files in Google Drive",
    inputSchema: {
      type: "object",
      properties: {
        folderId: {
          type: "string",
          description: "Folder ID to list files from (optional, defaults to root)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results (default: 20)",
        },
      },
    },
  },
  {
    name: "drive_search",
    description: "Search for files in Google Drive by name or content",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results (default: 20)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_get",
    description: "Get metadata for a specific file",
    inputSchema: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The file ID",
        },
      },
      required: ["fileId"],
    },
  },
  {
    name: "drive_read",
    description: "Read the content of a text-based file from Google Drive",
    inputSchema: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The file ID",
        },
      },
      required: ["fileId"],
    },
  },
];

function formatFileSize(bytes: string | undefined): string {
  if (!bytes) return "unknown";
  const size = parseInt(bytes, 10);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function handleDriveTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "drive_list": {
      const folderId = args.folderId as string | undefined;
      const maxResults = (args.maxResults as number) || 20;

      const files = await drive.listFiles(folderId, maxResults);

      return files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        size: formatFileSize(file.size),
      }));
    }

    case "drive_search": {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 20;

      const files = await drive.search(query, maxResults);

      return files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
      }));
    }

    case "drive_get": {
      const fileId = args.fileId as string;
      return drive.getFile(fileId);
    }

    case "drive_read": {
      const fileId = args.fileId as string;
      const content = await drive.readContent(fileId);
      return { content };
    }

    default:
      throw new Error(`Unknown Drive tool: ${name}`);
  }
}
