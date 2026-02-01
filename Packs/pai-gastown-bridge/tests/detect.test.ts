/**
 * Tests for Gas Town detection logic
 */

import { describe, it, expect } from 'bun:test';
import { detectGasTown } from '../src/detect';

describe('detectGasTown', () => {
  describe('not in Gas Town', () => {
    it('returns isGasTown=false for regular paths', () => {
      const result = detectGasTown('/Users/benjamin/projects/myapp');
      expect(result.isGasTown).toBe(false);
      expect(result.role).toBeNull();
      expect(result.rig).toBeNull();
    });

    it('returns isGasTown=false for paths with similar names', () => {
      const result = detectGasTown('/Users/benjamin/GasTownFake/crew');
      expect(result.isGasTown).toBe(false);
    });
  });

  describe('Gas Town root', () => {
    it('detects Gas Town root directory', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBeNull();
      expect(result.rig).toBeNull();
      expect(result.gasTownRoot).toBe('/Users/benjamin/EscapeVelocity/GasTown');
    });
  });

  describe('top-level roles', () => {
    it('detects mayor at top level', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/mayor');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('mayor');
      expect(result.rig).toBeNull();
    });

    it('detects deacon at top level', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/deacon/patrol');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('deacon');
      expect(result.rig).toBeNull();
    });

    it('detects daemon at top level', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/daemon');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('daemon');
      expect(result.rig).toBeNull();
    });
  });

  describe('rig-level paths', () => {
    it('detects rig without role', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/tinker');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBeNull();
      expect(result.rig).toBe('tinker');
      expect(result.rigRoot).toBe('/Users/benjamin/EscapeVelocity/GasTown/tinker');
    });

    it('detects harmony rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/harmony');
      expect(result.isGasTown).toBe(true);
      expect(result.rig).toBe('harmony');
    });
  });

  describe('nested roles', () => {
    it('detects crew in rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/harmony/crew');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('crew');
      expect(result.rig).toBe('harmony');
      expect(result.member).toBeNull();
    });

    it('detects crew member', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/harmony/crew/ben');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('crew');
      expect(result.rig).toBe('harmony');
      expect(result.member).toBe('ben');
    });

    it('detects crew member with deeper path', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/harmony/crew/ben/src/components');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('crew');
      expect(result.rig).toBe('harmony');
      expect(result.member).toBe('ben');
    });

    it('detects witness in rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/tinker/witness');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('witness');
      expect(result.rig).toBe('tinker');
    });

    it('detects polecats in rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/tinker/polecats/task-123');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('polecats');
      expect(result.rig).toBe('tinker');
      expect(result.member).toBeNull(); // polecats don't have members
    });

    it('detects refinery in rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/tinker/refinery');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('refinery');
      expect(result.rig).toBe('tinker');
    });

    it('detects mayor nested in rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/tinker/mayor');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('mayor');
      expect(result.rig).toBe('tinker');
    });
  });

  describe('edge cases', () => {
    it('handles paths with trailing slash', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/harmony/crew/');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('crew');
    });

    it('handles unknown subdirectory in rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/tinker/unknown');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBeNull();
      expect(result.rig).toBe('tinker');
    });

    it('handles config rig', () => {
      const result = detectGasTown('/Users/benjamin/EscapeVelocity/GasTown/config/crew');
      expect(result.isGasTown).toBe(true);
      expect(result.role).toBe('crew');
      expect(result.rig).toBe('config');
    });
  });
});
