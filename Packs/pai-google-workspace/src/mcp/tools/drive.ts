import { drive, forAccount } from "../../lib/google-client";
import type { ToolDefinition } from "../types";

const accountProperty = {
  account: {
    type: "string",
    description: "Google account email to use (optional, uses default account if not specified)",
  },
};

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
        ...accountProperty,
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
        ...accountProperty,
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
        ...accountProperty,
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
        ...accountProperty,
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

function getDriveClient(account?: string) {
  return account ? forAccount(account).drive : drive;
}

export async function handleDriveTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const account = args.account as string | undefined;
  const drv = getDriveClient(account);

  switch (name) {
    case "drive_list": {
      const folderId = args.folderId as string | undefined;
      const maxResults = (args.maxResults as number) || 20;

      const files = await drv.listFiles(folderId, maxResults);

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

      const files = await drv.search(query, maxResults);

      return files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
      }));
    }

    case "drive_get": {
      const fileId = args.fileId as string;
      return drv.getFile(fileId);
    }

    case "drive_read": {
      const fileId = args.fileId as string;
      const content = await drv.readContent(fileId);
      return { content };
    }

    default:
      throw new Error(`Unknown Drive tool: ${name}`);
  }
}
