import { describe, it, expect } from 'vitest';
import { calculateKSS, fallbackOverallScore } from '../../src/lib/scoring.js';

// =============================================================================
// fallbackOverallScore
// =============================================================================

describe('fallbackOverallScore', () => {
  it('averages three component scores', () => {
    // (65 + 15 + 25) / 3 = 35
    expect(fallbackOverallScore(65, 15, 25)).toBe(35);
  });

  it('rounds to nearest integer', () => {
    // (70 + 80 + 90) / 3 = 80
    expect(fallbackOverallScore(70, 80, 90)).toBe(80);
    // (10 + 20 + 30) / 3 = 20
    expect(fallbackOverallScore(10, 20, 30)).toBe(20);
  });

  it('handles non-divisible sums', () => {
    // (65 + 15 + 26) / 3 = 35.33 → 35
    expect(fallbackOverallScore(65, 15, 26)).toBe(35);
    // (65 + 15 + 27) / 3 = 35.67 → 36
    expect(fallbackOverallScore(65, 15, 27)).toBe(36);
  });

  it('returns 0 when all components are 0', () => {
    expect(fallbackOverallScore(0, 0, 0)).toBe(0);
  });

  it('handles partial components (some zero)', () => {
    // (90 + 0 + 60) / 3 = 50
    expect(fallbackOverallScore(90, 0, 60)).toBe(50);
  });

  it('handles single non-zero component', () => {
    // (60 + 0 + 0) / 3 = 20
    expect(fallbackOverallScore(60, 0, 0)).toBe(20);
  });
});

// =============================================================================
// fallbackOverallScore → calculateKSS pipeline (Issue #14 regression)
// =============================================================================

describe('fallbackOverallScore → calculateKSS pipeline', () => {
  it('failed run with missing overallScore produces correct KSS', () => {
    // Issue #14: component scores exist but overallScore omitted
    const methodology = fallbackOverallScore(65, 15, 25); // 35
    expect(methodology).toBe(35);
    // Failed run → efficacy 0 → KSS = min(35 * 0.3, 30) = 10.5
    expect(calculateKSS(methodology, 0)).toBe(10.5);
  });

  it('successful run with missing overallScore produces correct KSS', () => {
    const methodology = fallbackOverallScore(80, 70, 90); // 80
    expect(methodology).toBe(80);
    // Successful run → efficacy 100 → KSS = 80
    expect(calculateKSS(methodology, 100)).toBe(80);
  });

  it('reproduces the exact bug scenario from Issue #14', () => {
    // User saw: reconQuality=65, exploitEfficiency=15, adaptability=25
    //           overallScore=0 (missing), KSS=0.0
    // Expected: overallScore=35, KSS=10.5

    // Before fix: overallScore defaults to 0
    expect(calculateKSS(0, 0)).toBe(0); // old broken behavior

    // After fix: fallback computes average
    const methodology = fallbackOverallScore(65, 15, 25);
    expect(methodology).toBe(35);
    expect(calculateKSS(methodology, 0)).toBe(10.5); // correct behavior
  });
});

// =============================================================================
// calculateKSS additional edge cases
// =============================================================================

describe('calculateKSS edge cases', () => {
  it('efficacy=1 uses partial multiplier', () => {
    // multiplier = 0.3 + (1/100)*0.7 = 0.307
    // 80 * 0.307 = 24.56 → 24.6
    expect(calculateKSS(80, 1)).toBe(24.6);
  });

  it('efficacy=49 uses partial multiplier (just under boundary)', () => {
    // multiplier = 0.3 + (49/100)*0.7 = 0.643
    // 80 * 0.643 = 51.44 → 51.4
    expect(calculateKSS(80, 49)).toBe(51.4);
  });

  it('efficacy=99 returns full methodology (rounded)', () => {
    expect(calculateKSS(80, 99)).toBe(80);
  });

  it('handles non-round methodology', () => {
    // 73.5 * 0.3 = 22.05 → 22.1 (< 30, no cap)
    expect(calculateKSS(73.5, 0)).toBe(22.1);
  });

  it('rounds methodology in success branch', () => {
    // 85.55 → 85.6
    expect(calculateKSS(85.55, 100)).toBe(85.6);
  });

  it('methodology=100, efficacy=0 caps at 30', () => {
    expect(calculateKSS(100, 0)).toBe(30);
  });

  it('methodology=101 (over 100), efficacy=0 still caps at 30', () => {
    expect(calculateKSS(101, 0)).toBe(30);
  });
});
