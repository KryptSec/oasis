import { describe, it, expect } from 'vitest';
import {
  resolvePrice,
  estimateCost,
  estimateRunCost,
  summarizeCosts,
  formatUsd,
  MODEL_PRICES,
} from '../../src/lib/cost.js';
import type { RunResult, TokenUsage } from '../../src/lib/types.js';

function tokens(input: number, output: number): TokenUsage {
  return { input, output, total: input + output };
}

function makeRun(model: string, t: TokenUsage, flag: string | null = null): RunResult {
  return {
    id: 'run',
    model,
    modelVersion: model,
    challenge: 'challenge',
    startTime: new Date(0),
    endTime: new Date(0),
    success: flag != null,
    flag,
    totalTime: 1,
    iterations: 1,
    tokens: t,
    steps: [],
    techniquesUsed: [],
    tacticBreakdown: {},
    methodologies: [],
    toolsUsed: [],
    methodologyBreakdown: {},
  };
}

// =============================================================================
// resolvePrice
// =============================================================================

describe('resolvePrice', () => {
  it('resolves exact model ids', () => {
    expect(resolvePrice('claude-opus-4-8')?.input).toBe(15);
    expect(resolvePrice('zai-org/GLM-5.3-Flash')?.input).toBe(0.06);
  });

  it('is case-insensitive', () => {
    expect(resolvePrice('Claude-Opus-4-8')).not.toBeNull();
    expect(resolvePrice('ZAI-ORG/GLM-5.3')).not.toBeNull();
  });

  it('prefers more specific keys (glm-5.3-flash before glm-5.3)', () => {
    const flash = resolvePrice('zai-org/GLM-5.3-Flash');
    const standard = resolvePrice('zai-org/GLM-5.3');
    expect(flash?.input).toBe(0.06);
    expect(standard?.input).toBe(0.2);
    expect(flash?.input).not.toBe(standard?.input);
  });

  it('resolves versioned and provider-prefixed ids by substring', () => {
    expect(resolvePrice('moonshotai/Kimi-K3')?.input).toBe(0.3);
    expect(resolvePrice('MiniMaxAI/MiniMax-M3')?.input).toBe(0.2);
    expect(resolvePrice('Qwen/Qwen3.8-27B')?.input).toBe(0.1);
  });

  it('returns null for unknown and empty models', () => {
    expect(resolvePrice('some-unknown-model')).toBeNull();
    expect(resolvePrice('')).toBeNull();
  });
});

// =============================================================================
// MODEL_PRICES table sanity
// =============================================================================

describe('MODEL_PRICES', () => {
  it('has non-negative prices with a source for every entry', () => {
    for (const [key, price] of MODEL_PRICES) {
      expect(key.length).toBeGreaterThan(0);
      expect(price.input).toBeGreaterThanOrEqual(0);
      expect(price.output).toBeGreaterThanOrEqual(0);
      expect(price.source.length).toBeGreaterThan(0);
    }
  });

  it('lists no duplicate keys (dup keys would shadow silently)', () => {
    const keys = MODEL_PRICES.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// =============================================================================
// estimateCost
// =============================================================================

describe('estimateCost', () => {
  it('computes input + output cost correctly', () => {
    // opus: $15/1M in, $75/1M out
    const est = estimateCost('claude-opus-4-8', tokens(1_000_000, 1_000_000));
    expect(est.usd).toBeCloseTo(90, 6);
    expect(est.unpriced).toBe(false);
  });

  it('handles zero tokens on a priced model as $0 (not unpriced)', () => {
    const est = estimateCost('claude-opus-4-8', tokens(0, 0));
    expect(est.usd).toBe(0);
    expect(est.unpriced).toBe(false);
  });

  it('marks an unknown model with tokens as unpriced, never 0', () => {
    const est = estimateCost('who-knows', tokens(1000, 1000));
    expect(est.usd).toBeNull();
    expect(est.unpriced).toBe(true);
  });

  it('does not flag an unknown model with no tokens as unpriced', () => {
    const est = estimateCost('who-knows', tokens(0, 0));
    expect(est.usd).toBeNull();
    expect(est.unpriced).toBe(false);
  });

  it('scales linearly with token count', () => {
    const small = estimateCost('claude-haiku', tokens(1000, 1000));
    const large = estimateCost('claude-haiku', tokens(10_000, 10_000));
    expect(large.usd!).toBeCloseTo(small.usd! * 10, 9);
  });

  it('reports the price used, for auditability', () => {
    const est = estimateCost('moonshotai/Kimi-K3', tokens(1000, 0));
    expect(est.price?.source).toBe('deepinfra-list');
  });
});

// =============================================================================
// estimateRunCost
// =============================================================================

describe('estimateRunCost', () => {
  it('reads tokens off the run result', () => {
    const run = makeRun('claude-sonnet-4', tokens(2_000_000, 1_000_000));
    // sonnet: $3/1M in, $15/1M out → 6 + 15 = 21
    expect(estimateRunCost(run).usd).toBeCloseTo(21, 6);
  });

  it('prices off modelVersion when model is the coarse "custom" tag', () => {
    // Real OASIS runs record model: "custom" and put the provider id in
    // modelVersion — pricing off `model` alone would mark everything unpriced.
    const run: RunResult = {
      ...makeRun('custom', tokens(1_000_000, 1_000_000)),
      modelVersion: 'zai-org/GLM-5.3-Flash',
    };
    const est = estimateRunCost(run);
    expect(est.unpriced).toBe(false);
    expect(est.usd).toBeCloseTo(0.18, 6); // 0.06 in + 0.12 out
    expect(est.model).toBe('zai-org/GLM-5.3-Flash');
  });

  it('falls back to model when modelVersion is unpriceable', () => {
    const run: RunResult = {
      ...makeRun('claude-haiku', tokens(1_000_000, 0)),
      modelVersion: 'some-unknown-build',
    };
    const est = estimateRunCost(run);
    expect(est.unpriced).toBe(false);
    expect(est.usd).toBeCloseTo(0.8, 6);
  });

  it('reports the concrete id as unpriced when neither id resolves', () => {
    const run: RunResult = {
      ...makeRun('custom', tokens(100, 100)),
      modelVersion: 'totally-unknown',
    };
    const est = estimateRunCost(run);
    expect(est.usd).toBeNull();
    expect(est.unpriced).toBe(true);
  });
});

// =============================================================================
// summarizeCosts
// =============================================================================

describe('summarizeCosts', () => {
  it('returns an empty-but-valid summary for no runs', () => {
    const s = summarizeCosts([]);
    expect(s.totalUsd).toBe(0);
    expect(s.runCount).toBe(0);
    expect(s.flags).toBe(0);
    expect(s.usdPerFlag).toBeNull();
    expect(s.byModel).toEqual([]);
  });

  it('totals cost and flags across runs', () => {
    const runs = [
      makeRun('claude-opus-4-8', tokens(1_000_000, 1_000_000), 'FLAG{a}'), // $90
      makeRun('claude-opus-4-8', tokens(0, 0), null),                     // $0
      makeRun('claude-haiku', tokens(1_000_000, 0), 'FLAG{b}'),           // $0.80
    ];
    const s = summarizeCosts(runs);
    expect(s.totalUsd).toBeCloseTo(90.8, 6);
    expect(s.flags).toBe(2);
    expect(s.usdPerFlag).toBeCloseTo(45.4, 6);
    expect(s.runCount).toBe(3);
  });

  it('groups by model and computes per-model cost-per-flag', () => {
    const runs = [
      makeRun('claude-opus-4-8', tokens(1_000_000, 0), 'F1'), // $15
      makeRun('claude-opus-4-8', tokens(1_000_000, 0), 'F2'), // $15
      makeRun('claude-haiku', tokens(1_000_000, 0), null),    // $0.80, 0 flags
    ];
    const s = summarizeCosts(runs);

    const opus = s.byModel.find(m => m.model === 'claude-opus-4-8')!;
    expect(opus.runs).toBe(2);
    expect(opus.flags).toBe(2);
    expect(opus.usd).toBeCloseTo(30, 6);
    expect(opus.usdPerFlag).toBeCloseTo(15, 6);

    const haiku = s.byModel.find(m => m.model === 'claude-haiku')!;
    expect(haiku.flags).toBe(0);
    expect(haiku.usdPerFlag).toBeNull(); // no flags → no ratio, not Infinity
  });

  it('counts unpriced runs separately instead of pretending they are free', () => {
    const runs = [
      makeRun('claude-opus-4-8', tokens(1_000_000, 0), 'F'), // $15
      makeRun('mystery-model', tokens(500_000, 500_000), 'F'), // unpriced
    ];
    const s = summarizeCosts(runs);
    expect(s.unpricedRuns).toBe(1);
    expect(s.totalUsd).toBeCloseTo(15, 6); // mystery run contributes nothing
    expect(s.byModel.find(m => m.model === 'mystery-model')?.unpriced).toBe(true);
  });

  it('sorts models by spend, descending', () => {
    const runs = [
      makeRun('claude-haiku', tokens(1_000_000, 0), null),      // $0.80
      makeRun('claude-opus-4-8', tokens(1_000_000, 0), null),   // $15
    ];
    const s = summarizeCosts(runs);
    expect(s.byModel[0].model).toBe('claude-opus-4-8');
    expect(s.byModel[1].model).toBe('claude-haiku');
  });

  it('ignores empty-string flags when counting captures', () => {
    const runs = [makeRun('claude-haiku', tokens(1000, 0), '')];
    expect(summarizeCosts(runs).flags).toBe(0);
  });

  it('totals input and output tokens across runs', () => {
    const runs = [
      makeRun('claude-haiku', tokens(100, 200), null),
      makeRun('claude-haiku', tokens(300, 400), null),
    ];
    const s = summarizeCosts(runs);
    expect(s.totalInputTokens).toBe(400);
    expect(s.totalOutputTokens).toBe(600);
  });
});

// =============================================================================
// formatUsd
// =============================================================================

describe('formatUsd', () => {
  it('uses 4 decimals for sub-cent amounts so small runs are not shown as $0.00', () => {
    expect(formatUsd(0.0034)).toBe('$0.0034');
  });

  it('uses 2 decimals for normal amounts', () => {
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(90.8)).toBe('$90.80');
  });

  it('formats zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });
});
