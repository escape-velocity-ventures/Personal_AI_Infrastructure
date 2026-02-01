/**
 * pai-gastown-bridge
 *
 * Conditional loading of PAI features based on Gas Town role detection.
 *
 * @example
 * ```typescript
 * import { shouldRun } from 'pai-gastown-bridge';
 *
 * // In a PAI hook
 * const result = shouldRun({ feature: 'identity' });
 * if (!result.shouldRun) {
 *   console.error(`[PAI] Skipping: ${result.reason}`);
 *   process.exit(0);
 * }
 * ```
 *
 * @example
 * ```typescript
 * import { detectGasTown } from 'pai-gastown-bridge';
 *
 * // Get current context
 * const ctx = detectGasTown();
 * console.log(ctx.isGasTown, ctx.role, ctx.rig);
 * ```
 */

// Main API
export { shouldRun, getContext, clearContextCache, isMinimalMode } from './should-run';

// Detection
export { detectGasTown, isValidRole } from './detect';

// Matrix
export {
  DEFAULT_MATRIX,
  getRoleConfig,
  getFeatureState,
  ALL_FEATURES,
  ALL_ROLES,
} from './matrix';

// Types
export type {
  GasTownRole,
  GasTownContext,
  PAIFeature,
  FeatureState,
  ShouldRunResult,
  ShouldRunOptions,
  RoleConfig,
  MatrixConfig,
} from './types';
