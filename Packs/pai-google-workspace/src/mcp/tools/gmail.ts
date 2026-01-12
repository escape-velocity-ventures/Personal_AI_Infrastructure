import { gmail, forAccount } from "../../lib/google-client";
import type { ToolDefinition } from "../types";

const accountProperty = {
  account: {
    type: "string",
    description: "Google account email to use (optional, uses default account if not specified)",
  },
};

export const gmailTools: ToolDefinition[] = [
  {
    name: "gmail_search",
    description: "Search Gmail messages using Gmail search syntax (e.g., 'is:unread', 'from:example@gmail.com', 'subject:meeting')",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Gmail search query",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
        ...accountProperty,
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_read",
    description: "Read the full content of a Gmail message by ID",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The Gmail message ID",
        },
        ...accountProperty,
      },
      required: ["messageId"],
    },
  },
  {
    name: "gmail_send",
    description: "Send an email via Gmail",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject",
        },
        body: {
          type: "string",
          description: "Email body (plain text)",
        },
        ...accountProperty,
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_labels",
    description: "List all Gmail labels",
    inputSchema: {
      type: "object",
      properties: {
        ...accountProperty,
      },
    },
  },
];

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractBody(payload: {
  body?: { data?: string };
  parts?: { mimeType: string; body?: { data?: string } }[];
}): string {
  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
    }
  }

  return "";
}

function getGmailClient(account?: string) {
  return account ? forAccount(account).gmail : gmail;
}

export async function handleGmailTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const account = args.account as string | undefined;
  const gm = getGmailClient(account);

  switch (name) {
    case "gmail_search": {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 10;

      const messages = await gm.search(query, maxResults);

      // Fetch snippets for each message
      const results = await Promise.all(
        messages.map(async (msg) => {
          const full = await gm.getMessage(msg.id);
          const headers = full.payload.headers;
          const from = headers.find((h) => h.name === "From")?.value || "";
          const subject = headers.find((h) => h.name === "Subject")?.value || "";
          const date = headers.find((h) => h.name === "Date")?.value || "";

          return {
            id: msg.id,
            from,
            subject,
            date,
            snippet: full.snippet,
          };
        })
      );

      return results;
    }

    case "gmail_read": {
      const messageId = args.messageId as string;
      const message = await gm.getMessage(messageId);

      const headers = message.payload.headers;
      const from = headers.find((h) => h.name === "From")?.value || "";
      const to = headers.find((h) => h.name === "To")?.value || "";
      const subject = headers.find((h) => h.name === "Subject")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      const body = extractBody(message.payload);

      return {
        id: message.id,
        from,
        to,
        subject,
        date,
        labels: message.labelIds,
        body,
      };
    }

    case "gmail_send": {
      const to = args.to as string;
      const subject = args.subject as string;
      const body = args.body as string;

      const result = await gm.send(to, subject, body);
      return { success: true, messageId: result.id };
    }

    case "gmail_labels": {
      const labels = await gm.listLabels();
      return labels.map((l) => ({ id: l.id, name: l.name, type: l.type }));
    }

    default:
      throw new Error(`Unknown Gmail tool: ${name}`);
  }
}
