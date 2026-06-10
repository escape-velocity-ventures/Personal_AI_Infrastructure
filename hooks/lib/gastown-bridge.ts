/**
 * Safe wrapper for pai-gastown-bridge
 *
 * Handles the case where the bridge pack isn't installed or the path
 * is different (e.g., Linux vs macOS). Falls back to allowing all features.
 */

import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

// Types matching pai-gastown-bridge
export type PAIFeature =
  | 'identity'
  | 'voice'
  | 'memory-sync'
  | 'security'
  | 'infra-routing'
  | 'observability'
  | 'telos'
  | 'session'
  | 'tab-titles';

export interface GasTownContext {
  isGasTown: boolean;
  role: string | null;
  rig: string | null;
  member: string | null;
  rigRoot: string | null;
  gasTownRoot: string | null;
}

export interface ShouldRunResult {
  shouldRun: boolean;
  reason: string;
  context: GasTownContext;
}

export interface ShouldRunOptions {
  feature: PAIFeature;
  forceEnable?: boolean;
  forceDisable?: boolean;
}

// Default context when bridge isn't available
const DEFAULT_CONTEXT: GasTownContext = {
  isGasTown: false,
  role: null,
  rig: null,
  member: null,
  rigRoot: null,
  gasTownRoot: null,
};

// Possible locations for the bridge pack
const BRIDGE_PATHS = [
  // macOS path
  join(homedir(), 'EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src'),
  // Linux path (same structure)
  join(homedir(), 'EscapeVelocity/PersonalAI/PAI/Packs/pai-gastown-bridge/src'),
  // PAI_DIR-based path
  process.env.PAI_DIR ? join(process.env.PAI_DIR, 'Packs/pai-gastown-bridge/src') : '',
].filter(Boolean);

// Cache the loaded module
let bridgeModule: any = null;
let bridgeLoaded = false;

/**
 * Try to load the bridge module from known locations
 */
async function loadBridge(): Promise<any> {
  if (bridgeLoaded) return bridgeModule;

  for (const path of BRIDGE_PATHS) {
    if (existsSync(path)) {
      try {
        bridgeModule = await import(path);
        bridgeLoaded = true;
        return bridgeModule;
      } catch {
        // Try next path
      }
    }
  }

  bridgeLoaded = true;
  return null;
}

/**
 * Safe shouldRun wrapper - falls back to allowing if bridge unavailable
 */
export async function shouldRunSafe(options: ShouldRunOptions): Promise<ShouldRunResult> {
  try {
    const bridge = await loadBridge();
    if (bridge?.shouldRun) {
      return bridge.shouldRun(options);
    }
  } catch {
    // Fall through to default
  }

  // Default: allow everything if bridge not available
  return {
    shouldRun: true,
    reason: 'bridge-unavailable',
    context: DEFAULT_CONTEXT,
  };
}

/**
 * Synchronous version for hooks that can't use async at top level
 * Uses a pre-loaded cache or defaults to allow
 */
export function shouldRunSync(options: ShouldRunOptions): ShouldRunResult {
  if (bridgeModule?.shouldRun) {
    return bridgeModule.shouldRun(options);
  }

  // Default: allow everything
  return {
    shouldRun: true,
    reason: 'bridge-not-loaded',
    context: DEFAULT_CONTEXT,
  };
}

/**
 * Initialize the bridge (call early in async hooks)
 */
export async function initBridge(): Promise<boolean> {
  const bridge = await loadBridge();
  return bridge !== null;
}

/**
 * Check if running in minimal mode
 */
export function isMinimalMode(result: ShouldRunResult): boolean {
  return result.reason.endsWith('-minimal');
}
