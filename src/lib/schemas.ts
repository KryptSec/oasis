// Zod schemas for runtime validation of untrusted data boundaries
// (LLM responses, tool inputs, parsed JSON)

import { z } from 'zod';

// =============================================================================
// LLM Analysis Response — validates JSON from analyzer.ts parseAnalysisResponse
// =============================================================================

export const AnalysisResponseSchema = z.object({
  attackChain: z.object({
    phases: z.array(z.object({
      phase: z.string(),
      // Analyzers frequently emit a single-number range [3] or "3" instead of
      // [3, 7] — tolerate both (mirror to [n, n]) instead of rejecting the
      // whole analysis (observed in 17/21 parseFailed analyses, Sep/Oct 2026).
      stepRange: z.preprocess(
        (v) => {
          if (Array.isArray(v)) {
            const nums = v.map(x => (typeof x === 'number' ? x : Number(x))).filter(n => !Number.isNaN(n));
            if (nums.length === 0) return [0, 0];
            if (nums.length === 1) return [nums[0], nums[0]];
            return [nums[0], Math.max(...nums)];
          }
          if (typeof v === 'number' || typeof v === 'string') {
            const n = Number(v);
            return Number.isNaN(n) ? [0, 0] : [n, n];
          }
          return [0, 0];
        },
        z.tuple([z.number(), z.number()])
      ),
      description: z.string().default(''),
      techniques: z.array(z.string()).default([]),
    })).default([]),
    techniques: z.array(z.object({
      id: z.string(),
      name: z.string(),
      tactic: z.string(),
      description: z.string().default(''),
      stepsUsed: z.array(z.number()).default([]),
      confidence: z.number().default(0),
    })).default([]),
    killChainCoverage: z.array(z.string()).default([]),
  }).default({ phases: [], techniques: [], killChainCoverage: [] }),

  narrative: z.object({
    summary: z.string().default('Analysis unavailable'),
    detailed: z.string().default(''),
    keyFindings: z.array(z.string()).default([]),
  }).default({ summary: 'Analysis unavailable', detailed: '', keyFindings: [] }),

  behavior: z.object({
    approach: z.string().default('exploratory'),
    approachDescription: z.string().default(''),
    strengths: z.array(z.string()).default([]),
    inefficiencies: z.array(z.string()).default([]),
    // LLM analyzers intermittently emit numbers as strings ("85" not 85) —
    // coerce instead of rejecting the whole analysis (parseFailed) on that.
    decisionQuality: z.coerce.number().default(0),
  }).default({ approach: 'exploratory', approachDescription: '', strengths: [], inefficiencies: [], decisionQuality: 0 }),

  strategy: z.object({
    reconQuality: z.coerce.number().default(0),
    exploitEfficiency: z.coerce.number().default(0),
    adaptability: z.coerce.number().default(0),
    overallScore: z.coerce.number().optional(),
    scoreBreakdown: z.string().default(''),
  }).default({ reconQuality: 0, exploitEfficiency: 0, adaptability: 0, scoreBreakdown: '' }),

  rubricEvaluation: z.object({
    milestones: z.array(z.object({
      id: z.string(),
      achieved: z.coerce.boolean(),
      reasoning: z.string(),
    })).default([]),
    qualitative: z.object({
      reconQuality: z.object({ score: z.coerce.number(), reasoning: z.string() }).default({ score: 0, reasoning: '' }),
      techniqueSelection: z.object({ score: z.coerce.number(), reasoning: z.string() }).default({ score: 0, reasoning: '' }),
      adaptability: z.object({ score: z.coerce.number(), reasoning: z.string() }).default({ score: 0, reasoning: '' }),
    }).default({
      reconQuality: { score: 0, reasoning: '' },
      techniqueSelection: { score: 0, reasoning: '' },
      adaptability: { score: 0, reasoning: '' },
    }),
    penalties: z.array(z.object({
      type: z.string(),
      reason: z.string(),
    })).default([]),
  }).optional(),
}).passthrough();

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

// =============================================================================
// Tool Input — validates { command: string } from Claude/OpenAI tool_use
// =============================================================================

export const ToolInputSchema = z.object({
  command: z.string().min(1),
});

export type ToolInput = z.infer<typeof ToolInputSchema>;

// =============================================================================
// JSON Report — typed interface for report.ts generateJsonReport
// =============================================================================

export interface JsonReport {
  metadata: {
    runId: string;
    model: string;
    provider: string;
    challenge: string;
    startTime: Date;
    endTime: Date;
  };
  result: {
    success: boolean;
    flag: string | null;
    totalTime: number;
    iterations: number;
    tokens: { input: number; output: number; total: number };
  };
  techniques: unknown[];
  tacticBreakdown: Record<string, unknown>;
  toolsUsed: string[];
  steps: Array<{
    iteration: number;
    command: string | undefined;
    tool: string | undefined;
    success: boolean | undefined;
    duration: number;
    technique: string | null;
    reasoning: string | null;
  }>;
  analysis?: {
    overallScore: number;
    approach: string;
    narrative: string;
    keyFindings: string[];
    strategy: unknown;
    behavior: unknown;
    attackChain: unknown;
    rubricScore: unknown;
  };
}
