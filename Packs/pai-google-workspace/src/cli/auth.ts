#!/usr/bin/env bun
import { getAuthUrl, startOAuthServer } from "../auth/oauth-server";
import {
  loadTokens,
  deleteTokens,
  getTokenPath,
  listAccounts,
  setDefaultAccount,
  getDefaultAccount,
} from "../auth/token-manager";

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

async function main() {
  const parsed = parseArgs(args);

  switch (command) {
    case "login": {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        console.error("Missing Google credentials in environment.");
        console.error("Add these to your .env file:");
        console.error("  GOOGLE_CLIENT_ID=your-client-id");
        console.error("  GOOGLE_CLIENT_SECRET=your-client-secret");
        process.exit(1);
      }

      const authUrl = getAuthUrl();
      console.log("Opening browser for Google authentication...");
      console.log(`\nIf browser doesn't open, visit:\n${authUrl}\n`);

      // Open browser
      const { spawn } = await import("child_process");
      spawn("open", [authUrl], { detached: true });

      // Wait for OAuth callback
      const result = await startOAuthServer();
      console.log("\nAuthentication successful!");
      if (result.email) {
        console.log(`Account: ${result.email}`);
      }
      console.log(`Tokens saved to: ${getTokenPath()}`);
      break;
    }

    case "status": {
      const account = parsed.account;
      const tokens = loadTokens(account);

      if (!tokens) {
        console.log(account ? `Account not found: ${account}` : "Not authenticated.");
        console.log("Run: bun run auth login");
        process.exit(1);
      }

      const expiry = new Date(tokens.expiry_date);
      const isExpired = Date.now() >= tokens.expiry_date;

      console.log("Authentication Status");
      console.log("─".repeat(40));
      console.log(`Token file: ${getTokenPath()}`);
      if (tokens.email) {
        console.log(`Account: ${tokens.email}`);
      }
      console.log(`Scopes: ${tokens.scope}`);
      console.log(`Expires: ${expiry.toLocaleString()}`);
      console.log(`Status: ${isExpired ? "EXPIRED (will auto-refresh)" : "Valid"}`);
      break;
    }

    case "accounts": {
      const accounts = listAccounts();

      if (accounts.length === 0) {
        console.log("No accounts configured.");
        console.log("Run: bun run auth login");
        return;
      }

      console.log("Configured Accounts");
      console.log("─".repeat(40));
      for (const acc of accounts) {
        const marker = acc.isDefault ? " (default)" : "";
        console.log(`  ${acc.email}${marker}`);
      }
      break;
    }

    case "default": {
      const account = args[0];

      if (!account) {
        const current = getDefaultAccount();
        if (current) {
          console.log(`Default account: ${current}`);
        } else {
          console.log("No default account set.");
        }
        return;
      }

      setDefaultAccount(account);
      console.log(`Default account set to: ${account}`);
      break;
    }

    case "logout": {
      const account = parsed.account;

      if (account) {
        deleteTokens(account);
        console.log(`Account removed: ${account}`);
      } else {
        deleteTokens();
        console.log("All accounts removed. You are now logged out.");
      }
      break;
    }

    default:
      console.log("Usage: bun run auth <command> [options]");
      console.log("");
      console.log("Commands:");
      console.log("  login                     Authenticate with Google (add another account)");
      console.log("  status [--account EMAIL]  Check authentication status");
      console.log("  accounts                  List all configured accounts");
      console.log("  default [EMAIL]           Get or set default account");
      console.log("  logout [--account EMAIL]  Remove account (or all if no account specified)");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
