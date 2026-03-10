import { describe, it, expect } from 'vitest';
import {
  classifyToAttack,
  calculateTacticBreakdown,
  wasSuccessful,
  ATTACK_TECHNIQUES,
} from '../../src/lib/classifier.js';

// =============================================================================
// classifyToAttack — verify the algorithm, not every table row
// =============================================================================

describe('classifyToAttack', () => {
  it('respects priority ordering (exploit > recon)', () => {
    // curl with SQLi payload should match T1190 (exploit), not T1592 (recon/curl)
    const result = classifyToAttack("curl -d \"username=' OR '1'='1\"");
    expect(result?.id).toBe('T1190');
  });

  it('returns null for unrecognized commands', () => {
    expect(classifyToAttack('echo hello world')).toBeNull();
  });
});

// =============================================================================
// calculateTacticBreakdown — real logic with state
// =============================================================================

describe('calculateTacticBreakdown', () => {
  it('calculates percentage breakdown by tactic', () => {
    const techniques = [
      ATTACK_TECHNIQUES['T1592'],       // Reconnaissance
      ATTACK_TECHNIQUES['T1595.002'],   // Reconnaissance
      ATTACK_TECHNIQUES['T1190'],       // Initial Access
    ];
    const breakdown = calculateTacticBreakdown(techniques);

    expect(breakdown['Reconnaissance'].count).toBe(2);
    expect(breakdown['Reconnaissance'].percentage).toBeCloseTo(66.67, 0);
    expect(breakdown['Initial Access'].count).toBe(1);
    expect(breakdown['Initial Access'].percentage).toBeCloseTo(33.33, 0);
  });

  it('handles null techniques gracefully', () => {
    const techniques = [ATTACK_TECHNIQUES['T1190'], null, null];
    const breakdown = calculateTacticBreakdown(techniques);
    expect(breakdown['Initial Access'].count).toBe(1);
    expect(breakdown['Initial Access'].percentage).toBe(100);
  });

  it('returns empty object for empty input', () => {
    expect(calculateTacticBreakdown([])).toEqual({});
  });

  it('tracks unique technique IDs per tactic', () => {
    const techniques = [
      ATTACK_TECHNIQUES['T1595.002'],
      ATTACK_TECHNIQUES['T1595.003'],
    ];
    const breakdown = calculateTacticBreakdown(techniques);
    expect(breakdown['Reconnaissance'].techniques).toContain('T1595.002');
    expect(breakdown['Reconnaissance'].techniques).toContain('T1595.003');
  });
});

// =============================================================================
// wasSuccessful — output classification
// =============================================================================

describe('wasSuccessful', () => {
  it('returns true for output containing flag', () => {
    expect(wasSuccessful('cat flag.txt', 'KX{abc123}')).toBe(true);
  });

  it('returns false for error/failure indicators', () => {
    expect(wasSuccessful('curl http://target/missing', 'Not Found 404')).toBe(false);
    expect(wasSuccessful('curl http://target:9999', 'connection refused')).toBe(false);
    expect(wasSuccessful('curl http://target/admin', 'Access denied')).toBe(false);
  });

  it('returns false for empty output', () => {
    expect(wasSuccessful('cat missing.txt', '')).toBe(false);
  });

  it('returns true for non-empty output without indicators', () => {
    expect(wasSuccessful('ls', 'file1.txt\nfile2.txt')).toBe(true);
  });

  it('prioritizes success indicators over failure indicators', () => {
    expect(wasSuccessful('cat flag.txt', 'flag found despite error in parsing')).toBe(true);
  });
});
