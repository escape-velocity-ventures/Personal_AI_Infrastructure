/**
 * pai-gastown-bridge - Type Definitions
 *
 * Core types for Gas Town role detection and PAI feature management.
 */

/**
 * Valid Gas Town roles that can be detected from directory paths.
 */
export type GasTownRole =
  | 'crew'
  | 'witness'
  | 'polecats'
  | 'refinery'
  | 'mayor'
  | 'deacon'
  | 'daemon';

/**
 * PAI features that can be conditionally enabled/disabled.
 * Maps to specific hooks in ~/.claude/hooks/
 */
export type PAIFeature =
  | 'identity' // load-core-context.ts - CORE identity injection
  | 'voice' // voice-reminder.ts, stop-hook-voice.ts
  | 'memory-sync' // sync-memory-from-cloud.ts, sync-memory-to-cloud.ts
  | 'security' // security-validator.ts
  | 'infra-routing' // infra-routing-advisor.ts
  | 'observability' // capture-all-events.ts
  | 'telos' // telos-briefing.ts
  | 'session' // initialize-session.ts, session-capture.ts
  | 'tab-titles'; // update-tab-titles.ts

/**
 * Feature state in the role matrix.
 */
export type FeatureState = 'enabled' | 'disabled' | 'minimal';

/**
 * Context detected from the current working directory.
 */
export interface GasTownContext {
  /** Whether we're inside a Gas Town directory structure */
  isGasTown: boolean;
  /** The detected role, if any */
  role: GasTownRole | null;
  /** The rig name (tinker, harmony, config, etc.) */
  rig: string | null;
  /** For crew role: the member name */
  member: string | null;
  /** Full path to the rig root directory */
  rigRoot: string | null;
  /** Full path to the Gas Town root */
  gasTownRoot: string | null;
}

/**
 * Result from shouldRun() check.
 */
export interface ShouldRunResult {
  /** Whether the feature should execute */
  shouldRun: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** The detected Gas Town context */
  context: GasTownContext;
}

/**
 * Options for shouldRun() check.
 */
export interface ShouldRunOptions {
  /** The PAI feature to check */
  feature: PAIFeature;
  /** Force enable regardless of role (env override) */
  forceEnable?: boolean;
  /** Force disable regardless of role (env override) */
  forceDisable?: boolean;
}

/**
 * Role configuration from the matrix.
 */
export type RoleConfig = Record<PAIFeature, FeatureState>;

/**
 * Full matrix configuration.
 */
export interface MatrixConfig {
  roles: Record<GasTownRole, RoleConfig>;
  default: RoleConfig;
}
