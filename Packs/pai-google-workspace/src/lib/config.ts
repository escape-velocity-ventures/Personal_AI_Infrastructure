/**
 * Launch-independent configuration for the Google Workspace pack.
 *
 * // # secret-write-guard:override -- this module contains NO credential values; it resolves them at runtime from env files and never logs them
 *
 * Why this exists: the pack used to read the OAuth client settings only from
 * process.env, and fixed the token file from PAI_DIR at module load. Whether
 * that worked depended on how the session was started. A terminal shell may
 * have sourced ~/.env; a session started inside Claude Code gets
 * PAI_DIR=~/.claude and whatever manage.sh's loader exported. That loader read
 * $PAI_DIR/.env, where the Google variables are present but EMPTY, and the
 * empty export overrode real values (pai-config-81cn).
 *
 * Resolution rules (identical no matter how the process was launched):
 *   - A non-empty value in process.env always wins.
 *   - Otherwise, the first NON-EMPTY value from the candidate env files, in
 *     order. An empty value never shadows a real one.
 *   - Values are never logged; error messages list only file paths.
 */
import { existsSync, readFileSync } from "fs";
import { dirname } from "path";

const HOME = process.env.HOME || "";

function unique(paths: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Env files consulted for settings missing from process.env, highest priority first. */
export function candidateEnvFiles(): string[] {
  return unique([
    process.env.PAI_GOOGLE_ENV_FILE, // explicit override
    `${HOME}/.env`,
    process.env.PAI_DIR ? `${process.env.PAI_DIR}/.env` : undefined,
    `${HOME}/.config/pai/.env`,
    `${HOME}/.claude/.env`,
  ]);
}

const parsedCache = new Map<string, Record<string, string>>();

/** Minimal dotenv parser: KEY=VALUE, optional `export`, quotes, comments. */
export function parseEnvFile(path: string): Record<string, string> {
  const cached = parsedCache.get(path);
  if (cached) return cached;
  const result: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    parsedCache.set(path, result);
    return result;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2) {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    result[key] = value;
  }
  parsedCache.set(path, result);
  return result;
}

/** First non-empty value for `name`: process.env, then candidate env files. */
export function resolveSetting(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  for (const file of candidateEnvFiles()) {
    if (!existsSync(file)) continue;
    const value = parseEnvFile(file)[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export interface OAuthClient {
  id?: string;
  key?: string;
}

/** OAuth client id and client key for the token endpoint, resolved launch-independently. */
export function getOAuthClient(): OAuthClient {
  return {
    id: resolveSetting("GOOGLE_CLIENT_ID"),
    key: resolveSetting("GOOGLE_CLIENT_SECRET"),
  };
}

/** Error text naming where the client settings were looked for (paths only, never values). */
export function missingClientMessage(): string {
  const files = candidateEnvFiles()
    .map((f) => `  ${existsSync(f) ? "checked" : "absent "}  ${f}`)
    .join("\n");
  return (
    "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Looked in the process environment, then:\n" +
    files +
    "\nSet non-empty values in one of these files (or PAI_GOOGLE_ENV_FILE to point at another)."
  );
}

/** Candidate token files, highest priority first. */
export function candidateTokenFiles(): string[] {
  return unique([
    process.env.PAI_GOOGLE_TOKEN_FILE, // explicit override
    process.env.PAI_DIR ? `${process.env.PAI_DIR}/.google-tokens.json` : undefined,
    `${HOME}/.claude/.google-tokens.json`,
    `${HOME}/.config/pai/.google-tokens.json`,
  ]);
}

/**
 * Token file to use: an explicit override, else the first one that exists, so a
 * login made in one kind of session is found from the other. If none exists yet
 * (first login), use $PAI_DIR or ~/.config/pai, as before.
 */
export function resolveTokenPath(): string {
  const explicit = process.env.PAI_GOOGLE_TOKEN_FILE;
  if (explicit) return explicit;
  const existing = candidateTokenFiles().find((f) => existsSync(f));
  if (existing) return existing;
  const base = process.env.PAI_DIR || `${HOME}/.config/pai`;
  return `${base}/.google-tokens.json`;
}

export function tokenDir(tokenPath: string): string {
  return dirname(tokenPath);
}
