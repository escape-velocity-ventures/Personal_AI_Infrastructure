/**
 * AppleScript execution utilities for PAI Apple Ecosystem
 * Provides a clean interface for running AppleScript commands from TypeScript
 */

import { execSync, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface AppleScriptResult<T = string> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Execute AppleScript synchronously
 */
export function runAppleScript(script: string): AppleScriptResult {
  try {
    const result = execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large results
    });
    return { success: true, data: result.trim() };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "AppleScript execution failed",
    };
  }
}

/**
 * Execute AppleScript asynchronously
 */
export async function runAppleScriptAsync(script: string): Promise<AppleScriptResult> {
  try {
    const { stdout } = await execAsync(
      `osascript -e '${script.replace(/'/g, "'\"'\"'")}'`,
      {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    return { success: true, data: stdout.trim() };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "AppleScript execution failed",
    };
  }
}

/**
 * Execute a multi-line AppleScript from a heredoc-style string
 */
export async function runAppleScriptMultiline(script: string): Promise<AppleScriptResult> {
  try {
    // Write script to temp file to avoid shell escaping issues
    const tempFile = `/tmp/applescript_${Date.now()}.scpt`;
    await Bun.write(tempFile, script);

    const { stdout, stderr } = await execAsync(`osascript "${tempFile}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    // Clean up temp file
    await execAsync(`rm -f "${tempFile}"`);

    return { success: true, data: stdout.trim() };
  } catch (error: any) {
    return {
      success: false,
      error: error.stderr || error.message || "AppleScript execution failed",
    };
  }
}

/**
 * Execute JavaScript for Automation (JXA) - often cleaner than AppleScript
 */
export async function runJXA(script: string): Promise<AppleScriptResult> {
  try {
    const { stdout } = await execAsync(`osascript -l JavaScript <<'JXA'
${script}
JXA`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/bash",
    });
    return { success: true, data: stdout.trim() };
  } catch (error: any) {
    return {
      success: false,
      error: error.stderr || error.message || "JXA execution failed",
    };
  }
}

/**
 * Parse AppleScript list/record output into JSON
 * AppleScript returns data in a specific format that needs parsing
 */
export function parseAppleScriptList(output: string): string[] {
  if (!output || output === "missing value") return [];

  // Handle AppleScript list format: {item1, item2, item3}
  if (output.startsWith("{") && output.endsWith("}")) {
    const inner = output.slice(1, -1);
    // Split by comma but respect nested structures
    return splitAppleScriptList(inner);
  }

  return [output];
}

function splitAppleScriptList(str: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inQuotes = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (char === '"' && str[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && char === "{") {
      depth++;
      current += char;
    } else if (!inQuotes && char === "}") {
      depth--;
      current += char;
    } else if (!inQuotes && char === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

/**
 * Format a JavaScript Date to AppleScript date format
 */
export function toAppleScriptDate(date: Date): string {
  // AppleScript expects: date "Saturday, January 1, 2025 at 12:00:00 PM"
  return date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Format ISO date string for AppleScript
 */
export function isoToAppleScriptDate(isoString: string): string {
  return toAppleScriptDate(new Date(isoString));
}
