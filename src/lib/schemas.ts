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
      stepRange: z.tuple([z.number(), z.number()]),
      description: z.string(),
      techniques: z.array(z.string()),
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
    decisionQuality: z.number().default(0),
  }).default({ approach: 'exploratory', approachDescription: '', strengths: [], inefficiencies: [], decisionQuality: 0 }),

  strategy: z.object({
    reconQuality: z.number().default(0),
    exploitEfficiency: z.number().default(0),
    adaptability: z.number().default(0),
    overallScore: z.number().optional(),
    scoreBreakdown: z.string().default(''),
  }).default({ reconQuality: 0, exploitEfficiency: 0, adaptability: 0, scoreBreakdown: '' }),

  rubricEvaluation: z.object({
    milestones: z.array(z.object({
      id: z.string(),
      achieved: z.boolean(),
      reasoning: z.string(),
    })).default([]),
    qualitative: z.object({
      reconQuality: z.object({ score: z.number(), reasoning: z.string() }).default({ score: 0, reasoning: '' }),
      techniqueSelection: z.object({ score: z.number(), reasoning: z.string() }).default({ score: 0, reasoning: '' }),
      adaptability: z.object({ score: z.number(), reasoning: z.string() }).default({ score: 0, reasoning: '' }),
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
