#!/usr/bin/env bun
import { gmail, forAccount } from "../lib/google-client";

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

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function getGmailClient(account?: string) {
  return account ? forAccount(account).gmail : gmail;
}

async function main() {
  const parsed = parseArgs(args);
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

      if (!to || !subject || !body) {
        console.error("Usage: bun run gmail send --to <email> --subject <subject> --body <body> [--account EMAIL]");
        process.exit(1);
      }

      const result = await gm.send(to, subject, body);
      console.log(`Email sent! Message ID: ${result.id}`);
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
      console.log("  send --to --subject --body   Send an email");
      console.log("  labels                       List labels");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
