/**
 * pai-gastown-bridge - Role Feature Matrix
 *
 * Defines which PAI features are enabled/disabled for each Gas Town role.
 */

import type {
  GasTownRole,
  PAIFeature,
  FeatureState,
  RoleConfig,
  MatrixConfig,
} from './types';

/**
 * Default matrix configuration.
 *
 * This is the built-in configuration. Users can override via:
 * - ~/.claude/gastown-bridge.yaml
 * - Environment variables (PAI_GT_FORCE_ENABLE, PAI_GT_FORCE_DISABLE)
 */
export const DEFAULT_MATRIX: MatrixConfig = {
  roles: {
    // Human workspace - full PAI experience
    crew: {
      identity: 'enabled',
      voice: 'enabled',
      'memory-sync': 'enabled',
      security: 'enabled',
      'infra-routing': 'enabled',
      observability: 'enabled',
      telos: 'enabled',
      session: 'enabled',
      'tab-titles': 'enabled',
    },

    // Observer role - minimal overhead
    witness: {
      identity: 'disabled',
      voice: 'disabled',
      'memory-sync': 'disabled',
      security: 'enabled',
      'infra-routing': 'disabled',
      observability: 'enabled',
      telos: 'disabled',
      session: 'minimal',
      'tab-titles': 'disabled',
    },

    // Ephemeral workers - lean and fast
    polecats: {
      identity: 'disabled',
      voice: 'disabled',
      'memory-sync': 'disabled',
      security: 'enabled',
      'infra-routing': 'disabled',
      observability: 'enabled',
      telos: 'disabled',
      session: 'disabled',
      'tab-titles': 'disabled',
    },

    // Code review - security focused
    refinery: {
      identity: 'disabled',
      voice: 'disabled',
      'memory-sync': 'disabled',
      security: 'enabled',
      'infra-routing': 'disabled',
      observability: 'enabled',
      telos: 'disabled',
      session: 'minimal',
      'tab-titles': 'disabled',
    },

    // Orchestration - needs visibility
    mayor: {
      identity: 'disabled',
      voice: 'disabled',
      'memory-sync': 'disabled',
      security: 'enabled',
      'infra-routing': 'enabled',
      observability: 'enabled',
      telos: 'disabled',
      session: 'minimal',
      'tab-titles': 'disabled',
    },

    // System monitor - observability focused
    deacon: {
      identity: 'disabled',
      voice: 'disabled',
      'memory-sync': 'disabled',
      security: 'enabled',
      'infra-routing': 'disabled',
      observability: 'enabled',
      telos: 'disabled',
      session: 'minimal',
      'tab-titles': 'disabled',
    },

    // Background process - minimal
    daemon: {
      identity: 'disabled',
      voice: 'disabled',
      'memory-sync': 'disabled',
      security: 'enabled',
      'infra-routing': 'disabled',
      observability: 'enabled',
      telos: 'disabled',
      session: 'disabled',
      'tab-titles': 'disabled',
    },
  },

  // Default for non-GT sessions or unknown roles - full PAI
  default: {
    identity: 'enabled',
    voice: 'enabled',
    'memory-sync': 'enabled',
    security: 'enabled',
    'infra-routing': 'enabled',
    observability: 'enabled',
    telos: 'enabled',
    session: 'enabled',
    'tab-titles': 'enabled',
  },
};

/**
 * Get the feature configuration for a role.
 *
 * @param role - The Gas Town role (null for default)
 * @param matrix - Matrix config (defaults to DEFAULT_MATRIX)
 * @returns Role configuration
 */
export function getRoleConfig(
  role: GasTownRole | null,
  matrix: MatrixConfig = DEFAULT_MATRIX
): RoleConfig {
  if (role && matrix.roles[role]) {
    return matrix.roles[role];
  }
  return matrix.default;
}

/**
 * Get the state of a specific feature for a role.
 *
 * @param role - The Gas Town role (null for default)
 * @param feature - The PAI feature
 * @param matrix - Matrix config (defaults to DEFAULT_MATRIX)
 * @returns Feature state
 */
export function getFeatureState(
  role: GasTownRole | null,
  feature: PAIFeature,
  matrix: MatrixConfig = DEFAULT_MATRIX
): FeatureState {
  const config = getRoleConfig(role, matrix);
  return config[feature];
}

/**
 * List all PAI features.
 */
export const ALL_FEATURES: PAIFeature[] = [
  'identity',
  'voice',
  'memory-sync',
  'security',
  'infra-routing',
  'observability',
  'telos',
  'session',
  'tab-titles',
];

/**
 * List all Gas Town roles.
 */
export const ALL_ROLES: GasTownRole[] = [
  'crew',
  'witness',
  'polecats',
  'refinery',
  'mayor',
  'deacon',
  'daemon',
];
