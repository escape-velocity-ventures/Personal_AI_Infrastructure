#!/usr/bin/env bun
import { gmail, forAccount } from "../lib/google-client";
import { readFileSync, existsSync } from "fs";
import { basename } from "path";

const command = process.argv[2];
const args = process.argv.slice(3);

interface ParsedArgs {
  single: Record<string, string>;
  multiple: Record<string, string[]>;
}

function parseArgs(args: string[]): ParsedArgs {
  const single: Record<string, string> = {};
  const multiple: Record<string, string[]> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1] || "";

      // Keys that support multiple values
      if (key === "attachment") {
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
      const subject = parsed.subject;
      const body = parsed.body;
      const attachmentPaths = multiple.attachment || [];

      if (!to || !subject || !body) {
        console.error("Usage: bun run gmail send --to <email> --subject <subject> --body <body> [--attachment <file>]... [--account EMAIL]");
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

        const result = await gm.sendWithAttachment(to, subject, body, attachments);
        console.log(`Email sent with ${attachments.length} attachment(s)! Message ID: ${result.id}`);
      } else {
        const result = await gm.send(to, subject, body);
        console.log(`Email sent! Message ID: ${result.id}`);
      }
      break;
    }

    case "draft": {
      const to = parsed.to;
      const subject = parsed.subject;
      const attachmentPaths = multiple.attachment || [];

      // Bodies may be given inline or read from a file. --body-file is the
      // sane path for anything longer than a sentence, and the only one that
      // survives shell quoting of real prose.
      const body = parsed["body-file"]
        ? readFileSync(parsed["body-file"], "utf-8")
        : parsed.body;
      const htmlBody = parsed["html-body-file"]
        ? readFileSync(parsed["html-body-file"], "utf-8")
        : parsed["html-body"];

      if (!to || !subject || !body) {
        console.error(
          "Usage: bun run gmail draft --to <email> --subject <subject>\n" +
            "                          (--body <text> | --body-file <path>)\n" +
            "                          [--html-body <html> | --html-body-file <path>]\n" +
            "                          [--cc <email>] [--bcc <email>]\n" +
            "                          [--attachment <file>]... [--account EMAIL]"
        );
        process.exit(1);
      }

      const attachments: { filename: string; content: Buffer }[] = [];
      for (const filePath of attachmentPaths) {
        if (!existsSync(filePath)) {
          console.error(`Attachment not found: ${filePath}`);
          process.exit(1);
        }
        const content = readFileSync(filePath);
        attachments.push({ filename: basename(filePath), content });
        console.log(
          `Attaching: ${basename(filePath)} (${(content.length / 1024).toFixed(0)} KB)`
        );
      }

      // Gmail's own cap is 25MB on the encoded message; base64 inflates by ~4/3.
      const totalBytes = attachments.reduce((sum, a) => sum + a.content.length, 0);
      if (totalBytes * 1.37 > 25 * 1024 * 1024) {
        console.error(
          `Attachments total ${(totalBytes / 1024 / 1024).toFixed(1)} MB, which exceeds ` +
            `Gmail's 25MB limit once base64-encoded. Upload to Drive and link instead.`
        );
        process.exit(1);
      }

      const result = await gm.createDraft({
        to,
        subject,
        body,
        htmlBody,
        attachments,
        cc: parsed.cc,
        bcc: parsed.bcc,
      });

      console.log(
        `\nDraft created (NOT sent). Draft ID: ${result.id}` +
          `${attachments.length ? ` — ${attachments.length} attachment(s)` : ""}`
      );
      console.log("Review and send it from Gmail.");
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
      console.log("Usage: bun run gmail <command> [options]");
      console.log("");
      console.log("Global Options:");
      console.log("  --account EMAIL          Use specific Google account");
      console.log("");
      console.log("Commands:");
      console.log("  search <query> [--max N]     Search messages");
      console.log("  read <messageId>             Read a message");
      console.log("  send --to --subject --body   Send an email immediately");
      console.log("       [--attachment <file>]   Attach file (can repeat)");
      console.log("  draft --to --subject --body  Create a draft for review (does NOT send)");
      console.log("       [--body-file <path>]    Read the body from a file");
      console.log("       [--html-body-file <p>]  Read a formatted HTML body from a file");
      console.log("       [--cc] [--bcc]          Additional recipients");
      console.log("       [--attachment <file>]   Attach file (can repeat)");
      console.log("  labels                       List labels");
      console.log("");
      console.log("Examples:");
      console.log("  gmail send --to user@example.com --subject 'Hello' --body 'Message'");
      console.log("  gmail send --to user@example.com --subject 'Report' --body 'See attached' --attachment report.pdf");
      console.log("  gmail draft --to client@example.com --subject 'Proposal' \\");
      console.log("    --body-file email.txt --attachment a.pdf --attachment b.pdf");
      console.log("");
      console.log("Prefer `draft` over `send` for anything a person is accountable for —");
      console.log("it puts a human between the machine and the recipient.");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
