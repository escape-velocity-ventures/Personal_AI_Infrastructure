import { serve } from "bun";
import type { GoogleTokens, TokenResponse } from "./types";
import { saveTokens, getTokenPath, fetchUserInfo } from "./token-manager";

const PORT = parseInt(process.env.GOOGLE_OAUTH_PORT || "9876");
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive", // Full Drive access for file operations
  "https://www.googleapis.com/auth/documents", // Google Docs read/write
  "https://www.googleapis.com/auth/userinfo.email", // Added for account identification
];

export function getAuthUrl(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Missing GOOGLE_CLIENT_ID in environment");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = (await response.json()) as TokenResponse;

  if (!data.refresh_token) {
    throw new Error("No refresh token received. Try revoking app access at https://myaccount.google.com/permissions and re-authenticating.");
  }

  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope,
  };

  // Fetch user info to get email for account identification
  try {
    const userInfo = await fetchUserInfo(tokens.access_token);
    tokens.email = userInfo.email;
  } catch (err) {
    console.warn("Could not fetch user email:", err);
  }

  return tokens;
}

export async function startOAuthServer(): Promise<{ email?: string }> {
  return new Promise((resolve, reject) => {
    const server = serve({
      port: PORT,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            setTimeout(() => {
              server.stop();
              reject(new Error(`OAuth error: ${error}`));
            }, 100);
            return new Response(
              `<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`,
              { headers: { "Content-Type": "text/html" } }
            );
          }

          if (!code) {
            return new Response(
              `<html><body><h1>Error</h1><p>No authorization code received</p></body></html>`,
              { headers: { "Content-Type": "text/html" } }
            );
          }

          try {
            const tokens = await exchangeCodeForTokens(code);
            saveTokens(tokens, tokens.email);

            setTimeout(() => {
              server.stop();
              resolve({ email: tokens.email });
            }, 100);

            const accountInfo = tokens.email
              ? `<p>Account: <strong>${tokens.email}</strong></p>`
              : "";

            return new Response(
              `<html><body>
                <h1>Authentication Successful</h1>
                ${accountInfo}
                <p>Tokens saved to: ${getTokenPath()}</p>
                <p>You can close this window.</p>
              </body></html>`,
              { headers: { "Content-Type": "text/html" } }
            );
          } catch (err) {
            setTimeout(() => {
              server.stop();
              reject(err);
            }, 100);
            return new Response(
              `<html><body><h1>Error</h1><p>${err}</p></body></html>`,
              { headers: { "Content-Type": "text/html" } }
            );
          }
        }

        return new Response("Not found", { status: 404 });
      },
    });

    console.log(`OAuth callback server listening on port ${PORT}`);
  });
}
