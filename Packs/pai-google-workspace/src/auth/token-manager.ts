import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import type { GoogleTokens, TokenResponse } from "./types";

const PAI_DIR = process.env.PAI_DIR || `${process.env.HOME}/.config/pai`;
const TOKEN_FILE = `${PAI_DIR}/.google-tokens.json`;
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // Refresh 5 minutes before expiry

export function getTokenPath(): string {
  return TOKEN_FILE;
}

export function loadTokens(): GoogleTokens | null {
  if (!existsSync(TOKEN_FILE)) {
    return null;
  }
  try {
    const content = readFileSync(TOKEN_FILE, "utf-8");
    return JSON.parse(content) as GoogleTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: GoogleTokens): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  chmodSync(TOKEN_FILE, 0o600); // Owner read/write only
}

export function deleteTokens(): void {
  if (existsSync(TOKEN_FILE)) {
    const { unlinkSync } = require("fs");
    unlinkSync(TOKEN_FILE);
  }
}

export function isTokenExpired(tokens: GoogleTokens): boolean {
  return Date.now() >= tokens.expiry_date - TOKEN_REFRESH_BUFFER;
}

export async function refreshAccessToken(tokens: GoogleTokens): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = (await response.json()) as TokenResponse;

  const newTokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token, // Keep existing refresh token
    expiry_date: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope || tokens.scope,
  };

  saveTokens(newTokens);
  return newTokens;
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error("Not authenticated. Run: bun run auth login");
  }

  if (isTokenExpired(tokens)) {
    const refreshed = await refreshAccessToken(tokens);
    return refreshed.access_token;
  }

  return tokens.access_token;
}
