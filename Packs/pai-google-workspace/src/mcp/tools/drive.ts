import { drive, docs, forAccount } from "../../lib/google-client";
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

export const docsTools: ToolDefinition[] = [
  {
    name: "docs_read",
    description: "Read a Google Doc as plain text",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc document ID",
        },
        ...accountProperty,
      },
      required: ["documentId"],
    },
  },
  {
    name: "docs_get",
    description: "Get the full structure of a Google Doc (JSON)",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc document ID",
        },
        ...accountProperty,
      },
      required: ["documentId"],
    },
  },
  {
    name: "docs_append",
    description: "Append text to the end of a Google Doc",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc document ID",
        },
        content: {
          type: "string",
          description: "The text content to append",
        },
        ...accountProperty,
      },
      required: ["documentId", "content"],
    },
  },
  {
    name: "docs_update",
    description: "Replace all content in a Google Doc with new text",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc document ID",
        },
        content: {
          type: "string",
          description: "The new content to replace the document with",
        },
        ...accountProperty,
      },
      required: ["documentId", "content"],
    },
  },
  {
    name: "docs_find_replace",
    description: "Find and replace text in a Google Doc",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The Google Doc document ID",
        },
        find: {
          type: "string",
          description: "The text to find",
        },
        replace: {
          type: "string",
          description: "The replacement text",
        },
        matchCase: {
          type: "boolean",
          description: "Whether to match case (default: false)",
        },
        ...accountProperty,
      },
      required: ["documentId", "find", "replace"],
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

function getDocsClient(account?: string) {
  return account ? forAccount(account).docs : docs;
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

export async function handleDocsTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const account = args.account as string | undefined;
  const docsClient = getDocsClient(account);

  switch (name) {
    case "docs_read": {
      const documentId = args.documentId as string;
      const content = await docsClient.readAsText(documentId);
      return { content };
    }

    case "docs_get": {
      const documentId = args.documentId as string;
      return docsClient.getDocument(documentId);
    }

    case "docs_append": {
      const documentId = args.documentId as string;
      const content = args.content as string;
      await docsClient.append(documentId, content);
      return { success: true, message: "Content appended successfully" };
    }

    case "docs_update": {
      const documentId = args.documentId as string;
      const content = args.content as string;
      await docsClient.replaceContent(documentId, content);
      return { success: true, message: "Document content replaced successfully" };
    }

    case "docs_find_replace": {
      const documentId = args.documentId as string;
      const find = args.find as string;
      const replace = args.replace as string;
      const matchCase = (args.matchCase as boolean) || false;
      const result = await docsClient.findAndReplace(documentId, find, replace, matchCase);
      return { success: true, occurrencesChanged: result.occurrencesChanged };
    }

    default:
      throw new Error(`Unknown Docs tool: ${name}`);
  }
}
