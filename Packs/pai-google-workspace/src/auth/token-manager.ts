import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import type { GoogleTokens, MultiAccountTokenStorage, TokenResponse, GoogleUserInfo } from "./types";

const PAI_DIR = process.env.PAI_DIR || `${process.env.HOME}/.config/pai`;
const TOKEN_FILE = `${PAI_DIR}/.google-tokens.json`;
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // Refresh 5 minutes before expiry

export function getTokenPath(): string {
  return TOKEN_FILE;
}

function loadStorage(): MultiAccountTokenStorage {
  if (!existsSync(TOKEN_FILE)) {
    return { accounts: {} };
  }
  try {
    const content = readFileSync(TOKEN_FILE, "utf-8");
    const parsed = JSON.parse(content);

    // Migration: Check if old single-account format
    if (parsed.access_token && parsed.refresh_token) {
      // Old format - migrate to new format
      const legacyTokens = parsed as GoogleTokens;
      return {
        accounts: {
          _legacy: legacyTokens,
        },
        defaultAccount: "_legacy",
      };
    }

    return parsed as MultiAccountTokenStorage;
  } catch {
    return { accounts: {} };
  }
}

function saveStorage(storage: MultiAccountTokenStorage): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(storage, null, 2));
  chmodSync(TOKEN_FILE, 0o600); // Owner read/write only
}

export function loadTokens(account?: string): GoogleTokens | null {
  const storage = loadStorage();
  const accountKey = account || storage.defaultAccount;

  if (!accountKey) {
    // Return first available account if no default
    const accounts = Object.keys(storage.accounts);
    if (accounts.length === 0) return null;
    return storage.accounts[accounts[0]];
  }

  return storage.accounts[accountKey] || null;
}

export function saveTokens(tokens: GoogleTokens, account?: string): void {
  const storage = loadStorage();
  const accountKey = account || tokens.email || "_default";

  storage.accounts[accountKey] = tokens;

  // Set as default if first account or explicitly requested
  if (!storage.defaultAccount || Object.keys(storage.accounts).length === 1) {
    storage.defaultAccount = accountKey;
  }

  saveStorage(storage);
}

export function deleteTokens(account?: string): void {
  const storage = loadStorage();

  if (account) {
    delete storage.accounts[account];
    if (storage.defaultAccount === account) {
      const remaining = Object.keys(storage.accounts);
      storage.defaultAccount = remaining.length > 0 ? remaining[0] : undefined;
    }
  } else {
    // Delete all accounts
    storage.accounts = {};
    storage.defaultAccount = undefined;
  }

  saveStorage(storage);
}

export function listAccounts(): { email: string; isDefault: boolean }[] {
  const storage = loadStorage();
  return Object.keys(storage.accounts).map((email) => ({
    email,
    isDefault: email === storage.defaultAccount,
  }));
}

export function setDefaultAccount(account: string): void {
  const storage = loadStorage();
  if (!storage.accounts[account]) {
    throw new Error(`Account not found: ${account}`);
  }
  storage.defaultAccount = account;
  saveStorage(storage);
}

export function getDefaultAccount(): string | undefined {
  const storage = loadStorage();
  return storage.defaultAccount;
}

export function isTokenExpired(tokens: GoogleTokens): boolean {
  return Date.now() >= tokens.expiry_date - TOKEN_REFRESH_BUFFER;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  return response.json() as Promise<GoogleUserInfo>;
}

export async function refreshAccessToken(tokens: GoogleTokens, account?: string): Promise<GoogleTokens> {
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
    email: tokens.email,
  };

  saveTokens(newTokens, account || tokens.email);
  return newTokens;
}

export async function getValidAccessToken(account?: string): Promise<string> {
  const tokens = loadTokens(account);

  if (!tokens) {
    const accountMsg = account ? ` for account: ${account}` : "";
    throw new Error(`Not authenticated${accountMsg}. Run: bun run auth login`);
  }

  if (isTokenExpired(tokens)) {
    const refreshed = await refreshAccessToken(tokens, account);
    return refreshed.access_token;
  }

  return tokens.access_token;
}
