/**
 * pai-gastown-bridge - shouldRun() API
 *
 * The main entry point for PAI hooks to check whether they should execute.
 */

import type {
  PAIFeature,
  GasTownContext,
  ShouldRunResult,
  ShouldRunOptions,
} from './types';
import { detectGasTown } from './detect';
import { getFeatureState } from './matrix';

// Session-level cache for context detection
let cachedContext: GasTownContext | null = null;

/**
 * Check if a PAI feature should run based on:
 * 1. Environment variable overrides (highest priority)
 * 2. Existing PAI flags (PAI_HEADLESS, PAI_SKIP_*, subagent)
 * 3. Gas Town role-based matrix
 * 4. Default (allow)
 *
 * @param options - Check options
 * @returns Result with shouldRun boolean, reason, and context
 *
 * @example
 * ```typescript
 * import { shouldRun } from 'pai-gastown-bridge';
 *
 * const result = shouldRun({ feature: 'identity' });
 * if (!result.shouldRun) {
 *   console.error(`[PAI] Skipping: ${result.reason}`);
 *   process.exit(0);
 * }
 * ```
 */
export function shouldRun(options: ShouldRunOptions): ShouldRunResult {
  const { feature, forceEnable, forceDisable } = options;
  const context = getContext();

  // 1. Check explicit force disable (highest priority)
  if (forceDisable) {
    return { shouldRun: false, reason: 'force-disabled-option', context };
  }

  // 2. Check environment force disable
  const envForceDisable = process.env.PAI_GT_FORCE_DISABLE;
  if (envForceDisable && parseFeatureList(envForceDisable).includes(feature)) {
    return { shouldRun: false, reason: 'force-disabled-env', context };
  }

  // 3. Check explicit force enable
  if (forceEnable) {
    return { shouldRun: true, reason: 'force-enabled-option', context };
  }

  // 4. Check environment force enable
  const envForceEnable = process.env.PAI_GT_FORCE_ENABLE;
  if (envForceEnable && parseFeatureList(envForceEnable).includes(feature)) {
    return { shouldRun: true, reason: 'force-enabled-env', context };
  }

  // 5. Check existing PAI skip flags (e.g., PAI_SKIP_MEMORY_SYNC)
  const skipEnvVar = `PAI_SKIP_${feature.toUpperCase().replace(/-/g, '_')}`;
  if (process.env[skipEnvVar] === '1') {
    return { shouldRun: false, reason: 'pai-skip-flag', context };
  }

  // 6. Check headless mode
  if (process.env.PAI_HEADLESS === '1') {
    const headlessAllowed: PAIFeature[] = ['security', 'observability'];
    if (!headlessAllowed.includes(feature)) {
      return { shouldRun: false, reason: 'headless-mode', context };
    }
  }

  // 7. Check subagent mode (existing PAI pattern)
  if (isSubagentSession()) {
    const subagentAllowed: PAIFeature[] = ['security'];
    if (!subagentAllowed.includes(feature)) {
      return { shouldRun: false, reason: 'subagent-mode', context };
    }
  }

  // 8. Check Gas Town role matrix
  if (context.isGasTown && context.role) {
    const state = getFeatureState(context.role, feature);

    if (state === 'disabled') {
      return {
        shouldRun: false,
        reason: `gt-role-${context.role}-disabled`,
        context,
      };
    }

    if (state === 'minimal') {
      // For now, treat minimal as enabled
      // Individual hooks can check for minimal mode if they support it
      return {
        shouldRun: true,
        reason: `gt-role-${context.role}-minimal`,
        context,
      };
    }

    return {
      shouldRun: true,
      reason: `gt-role-${context.role}-enabled`,
      context,
    };
  }

  // 9. Default: allow (not in Gas Town, or no role detected)
  return { shouldRun: true, reason: 'default-allow', context };
}

/**
 * Get the cached Gas Town context.
 * Caches the result for the session to avoid repeated path parsing.
 */
export function getContext(): GasTownContext {
  if (!cachedContext) {
    cachedContext = detectGasTown();
  }
  return cachedContext;
}

/**
 * Clear the cached context (useful for testing).
 */
export function clearContextCache(): void {
  cachedContext = null;
}

/**
 * Check if running in a subagent session.
 * Matches existing PAI pattern.
 */
function isSubagentSession(): boolean {
  return (
    process.env.CLAUDE_CODE_AGENT !== undefined ||
    process.env.SUBAGENT === 'true'
  );
}

/**
 * Parse a comma-separated list of features.
 */
function parseFeatureList(value: string): PAIFeature[] {
  return value
    .split(',')
    .map((s) => s.trim() as PAIFeature)
    .filter(Boolean);
}

/**
 * Check if the feature state is "minimal" (for hooks that support reduced mode).
 *
 * @example
 * ```typescript
 * const result = shouldRun({ feature: 'session' });
 * if (result.shouldRun && isMinimalMode(result)) {
 *   // Run in minimal mode
 * }
 * ```
 */
export function isMinimalMode(result: ShouldRunResult): boolean {
  return result.reason.endsWith('-minimal');
}
