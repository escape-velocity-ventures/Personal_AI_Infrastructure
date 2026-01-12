#!/usr/bin/env bun
import { getAuthUrl, startOAuthServer } from "../auth/oauth-server";
import { loadTokens, deleteTokens, getTokenPath } from "../auth/token-manager";

const command = process.argv[2];

async function main() {
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
      await startOAuthServer();
      console.log("\nAuthentication successful!");
      console.log(`Tokens saved to: ${getTokenPath()}`);
      break;
    }

    case "status": {
      const tokens = loadTokens();
      if (!tokens) {
        console.log("Not authenticated.");
        console.log("Run: bun run auth login");
        process.exit(1);
      }

      const expiry = new Date(tokens.expiry_date);
      const isExpired = Date.now() >= tokens.expiry_date;

      console.log("Authentication Status");
      console.log("─".repeat(40));
      console.log(`Token file: ${getTokenPath()}`);
      console.log(`Scopes: ${tokens.scope}`);
      console.log(`Expires: ${expiry.toLocaleString()}`);
      console.log(`Status: ${isExpired ? "EXPIRED (will auto-refresh)" : "Valid"}`);
      break;
    }

    case "logout": {
      deleteTokens();
      console.log("Tokens deleted. You are now logged out.");
      break;
    }

    default:
      console.log("Usage: bun run auth <command>");
      console.log("");
      console.log("Commands:");
      console.log("  login   Authenticate with Google");
      console.log("  status  Check authentication status");
      console.log("  logout  Remove stored tokens");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
