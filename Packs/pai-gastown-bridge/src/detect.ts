/**
 * pai-gastown-bridge - Gas Town Detection
 *
 * Detects Gas Town context from the current working directory path.
 */

import type { GasTownContext, GasTownRole } from './types';

const VALID_ROLES: GasTownRole[] = [
  'crew',
  'witness',
  'polecats',
  'refinery',
  'mayor',
  'deacon',
  'daemon',
];

const TOP_LEVEL_ROLES: GasTownRole[] = ['mayor', 'deacon', 'daemon'];
const NESTED_ROLES: GasTownRole[] = ['crew', 'witness', 'polecats', 'refinery', 'mayor'];

/**
 * Detect Gas Town context from the current working directory.
 *
 * Path patterns:
 * - Top-level roles: /path/to/GasTown/{role}/...
 * - Rig-nested roles: /path/to/GasTown/{rig}/{role}/{member?}/...
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns GasTownContext with detection results
 */
export function detectGasTown(cwd: string = process.cwd()): GasTownContext {
  const notGasTown: GasTownContext = {
    isGasTown: false,
    role: null,
    rig: null,
    member: null,
    rigRoot: null,
    gasTownRoot: null,
  };

  // Look for GasTown marker in path
  // Handle both "/GasTown/" and paths ending with "/GasTown"
  const gasTownMarker = '/GasTown/';
  let idx = cwd.indexOf(gasTownMarker);
  let gasTownRoot: string;

  if (idx === -1) {
    // Check if path ends with /GasTown (no trailing slash)
    if (cwd.endsWith('/GasTown')) {
      gasTownRoot = cwd;
      // Return context for being at GT root
      return {
        isGasTown: true,
        role: null,
        rig: null,
        member: null,
        rigRoot: null,
        gasTownRoot,
      };
    }
    return notGasTown;
  }

  gasTownRoot = cwd.slice(0, idx + gasTownMarker.length - 1);
  const afterGT = cwd.slice(idx + gasTownMarker.length);
  const parts = afterGT.split('/').filter(Boolean);

  if (parts.length === 0) {
    // At GasTown root itself
    return {
      isGasTown: true,
      role: null,
      rig: null,
      member: null,
      rigRoot: null,
      gasTownRoot,
    };
  }

  const firstPart = parts[0];

  // Check if first part is a top-level role
  if (TOP_LEVEL_ROLES.includes(firstPart as GasTownRole)) {
    return {
      isGasTown: true,
      role: firstPart as GasTownRole,
      rig: null,
      member: null,
      rigRoot: null,
      gasTownRoot,
    };
  }

  // First part is a rig name
  const rig = firstPart;
  const rigRoot = `${gasTownRoot}/${rig}`;

  if (parts.length === 1) {
    // At rig root, no role yet
    return {
      isGasTown: true,
      role: null,
      rig,
      member: null,
      rigRoot,
      gasTownRoot,
    };
  }

  // Check if second part is a nested role
  const secondPart = parts[1];
  if (NESTED_ROLES.includes(secondPart as GasTownRole)) {
    const role = secondPart as GasTownRole;
    const member = role === 'crew' && parts[2] ? parts[2] : null;

    return {
      isGasTown: true,
      role,
      rig,
      member,
      rigRoot,
      gasTownRoot,
    };
  }

  // Inside rig but not in a recognized role directory
  return {
    isGasTown: true,
    role: null,
    rig,
    member: null,
    rigRoot,
    gasTownRoot,
  };
}

/**
 * Check if a string is a valid Gas Town role.
 */
export function isValidRole(role: string): role is GasTownRole {
  return VALID_ROLES.includes(role as GasTownRole);
}
