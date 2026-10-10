#!/usr/bin/env bun
import { gmail, forAccount, type ReplyOptions, type AddressOptions } from "../lib/google-client";
import { buildFilter, describeFilter, type FilterSpec } from "../lib/filters";
import { resolveFrom } from "../lib/mime";
import { readFileSync, existsSync } from "fs";
import { basename } from "path";

const command = process.argv[2];
const args = process.argv.slice(3);

// Handle --help anywhere in the command line
if (process.argv.includes("--help") || process.argv.includes("-h") || !command) {
  console.log("Usage: bun run gmail <command> [options]");
  console.log("");
  console.log("Global Options:");
  console.log("  --account EMAIL          Use specific Google account");
  console.log("  --help, -h               Show this help message");
  console.log("");
  console.log("Commands:");
  console.log("  search <query> [--max N]     Search messages");
  console.log("  read <messageId>             Read a message");
  console.log("  send --to --subject --body   Send an email");
  console.log("       [--attachment <file>]   Attach file (can repeat)");
  console.log("       [--reply-to <messageId>] Reply in that message's thread;");
  console.log("                                --subject defaults to \"Re: <original>\"");
  console.log("       [--from <addr>]               Send as this address; must be a verified");
  console.log("                                     send-as of the account (default: its default)");
  console.log("       [--cc <addr>] [--bcc <addr>]  Extra recipients (each can repeat)");
  console.log("       [--reply-to-address <addr>]   Reply-To header (can repeat); not the");
  console.log("                                     same as --reply-to, which threads");
  console.log("  labels                       List labels");
  console.log("  filters                      List filters");
  console.log("  filter-create  criteria: [--from X] [--to X] [--subject X] [--query Q]");
  console.log("                           [--negated-query Q] [--has-attachment]");
  console.log("                 actions:  [--label NAME]... [--archive] [--mark-read] [--star]");
  console.log("                           [--important | --never-important] [--never-spam]");
  console.log("                 [--dry-run]  Print the filter without creating it");
  console.log("                 (needs gmail.settings.basic; forward and trash are not supported)");
  console.log("  filter-delete <filterId>     Delete a filter");
  console.log("");
  console.log("Examples:");
  console.log("  gmail send --to user@example.com --subject 'Hello' --body 'Message'");
  console.log("  gmail send --to user@example.com --subject 'Report' --body 'See attached' --attachment report.pdf");
  console.log("  gmail send --to user@example.com --subject 'Files' --body 'Multiple' --attachment a.pdf --attachment b.png");
  console.log("  gmail send --to user@example.com --reply-to 1a1188d82faf4140 --body 'Following up'");
  process.exit(0);
}

interface ParsedArgs {
  single: Record<string, string>;
  multiple: Record<string, string[]>;
}

const BOOLEAN_FLAGS = new Set([
  "help", "h",
  // filter-create actions and options
  "archive", "mark-read", "star", "important", "never-important", "never-spam", "has-attachment", "dry-run",
]);
const MULTI_FLAGS = new Set(["attachment", "cc", "bcc", "reply-to-address", "label"]);

function parseArgs(args: string[]): ParsedArgs {
  const single: Record<string, string> = {};
  const multiple: Record<string, string[]> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);

      // Boolean flags: record as "true" without consuming the next arg
      if (BOOLEAN_FLAGS.has(key)) {
        single[key] = "true";
        continue;
      }

      const value = args[i + 1] || "";

      // Keys that support multiple values
      if (MULTI_FLAGS.has(key)) {
        if (!multiple[key]) multiple[key] = [];
        multiple[key].push(value);
      } else {
        single[key] = value;
      }
      i++;
    }
  }

  return { single, multiple };
}

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function getGmailClient(account?: string) {
  return account ? forAccount(account).gmail : gmail;
}

async function main() {
  const { single: parsed, multiple } = parseArgs(args);
  const account = parsed.account;
  const gm = getGmailClient(account);

  switch (command) {
    case "search": {
      const query = args[0];
      const maxResults = parseInt(parsed.max || "10", 10);

      if (!query) {
        console.error("Usage: bun run gmail search <query> [--max N] [--account EMAIL]");
        process.exit(1);
      }

      console.log(`Searching: "${query}"\n`);
      const messages = await gm.search(query, maxResults);

      if (messages.length === 0) {
        console.log("No messages found.");
        return;
      }

      for (const msg of messages) {
        const full = await gm.getMessage(msg.id);
        const headers = full.payload.headers;
        const from = headers.find((h) => h.name === "From")?.value || "";
        const subject = headers.find((h) => h.name === "Subject")?.value || "";
        const date = headers.find((h) => h.name === "Date")?.value || "";

        console.log(`ID: ${msg.id}`);
        console.log(`From: ${from}`);
        console.log(`Subject: ${subject}`);
        console.log(`Date: ${date}`);
        console.log(`Snippet: ${full.snippet}`);
        console.log("─".repeat(60));
      }
      break;
    }

    case "read": {
      const messageId = args[0];

      if (!messageId) {
        console.error("Usage: bun run gmail read <messageId> [--account EMAIL]");
        process.exit(1);
      }

      const message = await gm.getMessage(messageId);
      const headers = message.payload.headers;

      console.log(`From: ${headers.find((h) => h.name === "From")?.value || ""}`);
      console.log(`To: ${headers.find((h) => h.name === "To")?.value || ""}`);
      console.log(`Subject: ${headers.find((h) => h.name === "Subject")?.value || ""}`);
      console.log(`Date: ${headers.find((h) => h.name === "Date")?.value || ""}`);
      console.log(`Labels: ${message.labelIds.join(", ")}`);
      console.log("\n" + "─".repeat(60) + "\n");

      // Extract body
      if (message.payload.body?.data) {
        console.log(decodeBase64(message.payload.body.data));
      } else if (message.payload.parts) {
        for (const part of message.payload.parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            console.log(decodeBase64(part.body.data));
            break;
          }
        }
      }
      break;
    }

    case "send": {
      const to = parsed.to;
      let subject = parsed.subject;
      const body = parsed.body;
      const attachmentPaths = multiple.attachment || [];
      const replyToId = parsed["reply-to"];
      let fromHeader: string | undefined;
      if (parsed.from) {
        try {
          fromHeader = resolveFrom(parsed.from, await gm.listSendAs());
        } catch (e) {
          console.error(`send: ${(e as Error).message}`);
          process.exit(1);
        }
      }
      const addr: AddressOptions = {
        from: fromHeader,
        cc: multiple.cc,
        bcc: multiple.bcc,
        replyTo: multiple["reply-to-address"],
      };
      let reply: ReplyOptions | undefined;

      if (replyToId) {
        const resolved = await gm.replyTo(replyToId);
        reply = resolved.reply;
        subject = subject || resolved.subject;
      }

      if (!to || !subject || !body) {
        console.error("Usage: bun run gmail send --to <email> (--subject <subject> | --reply-to <messageId>) --body <body> [--attachment <file>]... [--cc <addr>]... [--bcc <addr>]... [--reply-to-address <addr>]... [--account EMAIL]");
        process.exit(1);
      }

      // Check if we have attachments
      if (attachmentPaths.length > 0) {
        const attachments: { filename: string; content: Buffer }[] = [];

        for (const filePath of attachmentPaths) {
          if (!existsSync(filePath)) {
            console.error(`Attachment not found: ${filePath}`);
            process.exit(1);
          }
          const content = readFileSync(filePath);
          const filename = basename(filePath);
          attachments.push({ filename, content });
          console.log(`Attaching: ${filename} (${content.length} bytes)`);
        }

        const result = await gm.sendWithAttachment(to, subject, body, attachments, reply, addr);
        console.log(`Email sent with ${attachments.length} attachment(s)! Message ID: ${result.id}`);
      } else {
        const result = await gm.send(to, subject, body, reply, addr);
        console.log(`Email sent! Message ID: ${result.id}${reply ? ` (thread ${result.threadId})` : ""}`);
      }
      break;
    }

    case "filters": {
      const [filters, labels] = await Promise.all([gm.listFilters(), gm.listLabels()]);
      if (filters.length === 0) {
        console.log("No filters.");
        break;
      }
      for (const f of filters) console.log(describeFilter(f, labels));
      break;
    }

    case "filter-create": {
      const spec: FilterSpec = {
        from: parsed.from,
        to: parsed.to,
        subject: parsed.subject,
        query: parsed.query,
        negatedQuery: parsed["negated-query"],
        hasAttachment: parsed["has-attachment"] === "true",
        labels: multiple.label,
        archive: parsed.archive === "true",
        markRead: parsed["mark-read"] === "true",
        star: parsed.star === "true",
        important: parsed.important === "true",
        neverImportant: parsed["never-important"] === "true",
        neverSpam: parsed["never-spam"] === "true",
      };
      const labels = await gm.listLabels();
      let filter;
      try {
        filter = buildFilter(spec, labels);
      } catch (e) {
        console.error(`filter-create: ${(e as Error).message}`);
        process.exit(1);
      }
      if (parsed["dry-run"] === "true") {
        console.log("Dry run, not created:");
        console.log(describeFilter(filter, labels));
        console.log(JSON.stringify(filter, null, 2));
        break;
      }
      const created = await gm.createFilter(filter);
      console.log(`Filter created: ${describeFilter(created, labels)}`);
      break;
    }

    case "filter-delete": {
      const id = args[0];
      if (!id || id.startsWith("--")) {
        console.error("Usage: bun run gmail filter-delete <filterId> [--account EMAIL]");
        process.exit(1);
      }
      await gm.deleteFilter(id);
      console.log(`Filter deleted: ${id}`);
      break;
    }

    case "labels": {
      const labels = await gm.listLabels();
      console.log("Gmail Labels:");
      console.log("─".repeat(40));
      for (const label of labels) {
        console.log(`${label.name} (${label.type})`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'bun run gmail --help' for usage.");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
