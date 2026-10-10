import { gmail, forAccount, type ReplyOptions, type AddressOptions } from "../../lib/google-client";
import { buildFilter, describeFilter, type FilterSpec } from "../../lib/filters";
import { resolveFrom } from "../../lib/mime";
import type { ToolDefinition } from "../types";

// MCP clients don't all honour the array schema; accept one address as a plain
// string too, and reject anything else rather than failing deep in the send.
function addressArg(name: string, v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  throw new Error(`${name} must be a string or an array of strings`);
}

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
    description: "Send an email via Gmail, optionally as a threaded reply",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          // Not in `required`: it is optional when replyTo is set. The handler
          // rejects a send with neither, so callers see that as a tool error.
          description: "Email subject. REQUIRED unless replyTo is set, in which case it defaults to \"Re: <original subject>\"",
        },
        body: {
          type: "string",
          description: "Email body (plain text)",
        },
        replyTo: {
          type: "string",
          description: "Gmail message ID to reply to; the email is threaded under it",
        },
        from: {
          type: "string",
          description: "Send as this address. Must be the account's primary address or a verified send-as alias; omit to use the account's default send-as",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Cc recipients, one address per entry",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "Bcc recipients, one address per entry",
        },
        replyToAddress: {
          type: "array",
          items: { type: "string" },
          description: "Reply-To header addresses, one per entry (where replies go; unrelated to replyTo, which threads)",
        },
        ...accountProperty,
      },
      required: ["to", "body"],
    },
  },
  {
    name: "gmail_filters_list",
    description: "List Gmail filters, with label IDs shown as names",
    inputSchema: { type: "object", properties: { ...accountProperty } },
  },
  {
    name: "gmail_filter_create",
    description:
      "Create a Gmail filter. Needs at least one criterion and one action. Labels must already exist. Forwarding and trash are not supported. Set dryRun to preview without creating.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        subject: { type: "string" },
        query: { type: "string", description: "Gmail search query, e.g. 'list:news.example.com'" },
        negatedQuery: { type: "string" },
        hasAttachment: { type: "boolean" },
        labels: { type: "array", items: { type: "string" }, description: "Existing label NAMES to apply" },
        archive: { type: "boolean", description: "Skip the inbox" },
        markRead: { type: "boolean" },
        star: { type: "boolean" },
        important: { type: "boolean" },
        neverImportant: { type: "boolean" },
        neverSpam: { type: "boolean" },
        dryRun: { type: "boolean", description: "Return the filter that would be created, without creating it" },
        ...accountProperty,
      },
    },
  },
  {
    name: "gmail_filter_delete",
    description: "Delete a Gmail filter by ID",
    inputSchema: {
      type: "object",
      properties: { filterId: { type: "string" }, ...accountProperty },
      required: ["filterId"],
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
      let subject = args.subject as string | undefined;
      const body = args.body as string;
      const replyToId = args.replyTo as string | undefined;

      let reply: ReplyOptions | undefined;
      if (replyToId) {
        const resolved = await gm.replyTo(replyToId);
        reply = resolved.reply;
        subject = subject || resolved.subject;
      }
      if (!subject) {
        throw new Error("subject is required unless replyTo is set");
      }

      const fromReq = args.from as string | undefined;
      const addr: AddressOptions = {
        from: fromReq ? resolveFrom(fromReq, await gm.listSendAs()) : undefined,
        cc: addressArg("cc", args.cc),
        bcc: addressArg("bcc", args.bcc),
        replyTo: addressArg("replyToAddress", args.replyToAddress),
      };
      const result = await gm.send(to, subject, body, reply, addr);
      return { success: true, messageId: result.id, threadId: result.threadId };
    }

    case "gmail_filters_list": {
      const [filters, labels] = await Promise.all([gm.listFilters(), gm.listLabels()]);
      return filters.map((f) => ({ id: f.id, summary: describeFilter(f, labels), criteria: f.criteria, action: f.action }));
    }

    case "gmail_filter_create": {
      const spec: FilterSpec = {
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        subject: args.subject as string | undefined,
        query: args.query as string | undefined,
        negatedQuery: args.negatedQuery as string | undefined,
        hasAttachment: args.hasAttachment === true,
        labels: addressArg("labels", args.labels),
        archive: args.archive === true,
        markRead: args.markRead === true,
        star: args.star === true,
        important: args.important === true,
        neverImportant: args.neverImportant === true,
        neverSpam: args.neverSpam === true,
      };
      const labels = await gm.listLabels();
      const filter = buildFilter(spec, labels); // throws with an actionable message
      if (args.dryRun === true) return { dryRun: true, summary: describeFilter(filter, labels), filter };
      const created = await gm.createFilter(filter);
      return { success: true, id: created.id, summary: describeFilter(created, labels) };
    }

    case "gmail_filter_delete": {
      const id = args.filterId as string;
      if (!id) throw new Error("filterId is required");
      await gm.deleteFilter(id);
      return { success: true, deleted: id };
    }

    case "gmail_labels": {
      const labels = await gm.listLabels();
      return labels.map((l) => ({ id: l.id, name: l.name, type: l.type }));
    }

    default:
      throw new Error(`Unknown Gmail tool: ${name}`);
  }
}
