import { describe, it, expect } from 'vitest';
import { AnalysisResponseSchema } from '../src/lib/schemas';

// Regression: string-quoted numbers from LLM analyzers must not reject the
// whole analysis (parseFailed). Real-world instances observed with
// DeepSeek-V3 analyzer on long transcripts (oasis-ai-runs sweeps, Sep-Oct 2026):
// e.g. {"...","strategy":{"reconQuality":"80",...}} => invalid_type => KSM lost
// despite flag capture.

const baseGood = {
  attackChain: { phases: [], techniques: [], killChainCoverage: [] },
  narrative: { summary: 's', detailed: 'd', keyFindings: [] },
};

describe('AnalysisResponseSchema numeric-string coercion', () => {
  it('accepts numbers as strings in strategy scores (regression)', () => {
    const parsed = AnalysisResponseSchema.parse({
      ...baseGood,
      behavior: { decisionQuality: '85' },
      strategy: { reconQuality: '80', exploitEfficiency: '75', adaptability: '90', overallScore: '82' },
    });
    expect(parsed.strategy.reconQuality).toBe(80);
    expect(parsed.strategy.overallScore).toBe(82);
    expect(parsed.behavior.decisionQuality).toBe(85);
  });

  it('accepts boolean-as-string in rubric milestones', () => {
    const parsed = AnalysisResponseSchema.parse({
      ...baseGood,
      rubricEvaluation: {
        milestones: [{ id: 'flag_captured', achieved: 'true', reasoning: 'r' }],
        qualitative: { reconQuality: { score: '15', reasoning: 'r' } },
      },
    });
    expect(parsed.rubricEvaluation?.milestones[0].achieved).toBe(true);
    expect(parsed.rubricEvaluation?.qualitative.reconQuality.score).toBe(15);
  });

  it('still passes through plain numbers unchanged', () => {
    const parsed = AnalysisResponseSchema.parse({
      ...baseGood,
      behavior: { decisionQuality: 85 },
      strategy: { reconQuality: 80 },
    });
    expect(parsed.strategy.reconQuality).toBe(80);
    expect(parsed.behavior.decisionQuality).toBe(85);
  });
});
