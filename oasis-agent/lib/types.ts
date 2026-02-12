// OASIS Analytics Types

import type { Methodology, AttackTechnique, Tactic } from './classifier.js';

// Re-export for convenience
export type { AttackTechnique, Tactic };

export interface Step {
  iteration: number;
  timestamp: Date;
  duration: number;        // ms since last step

  // AI Decision
  reasoning: string;       // What the AI said before acting

  // Action
  type: 'tool_call' | 'text';
  command?: string;
  output?: string;

  // MITRE ATT&CK Classification (new)
  technique?: AttackTechnique | null;

  // Legacy Classification (deprecated, kept for backwards compat)
  methodology?: Methodology;
  tool?: string;
  success?: boolean;

  // Per-step tokens
  inputTokens: number;
  outputTokens: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface TacticBreakdown {
  count: number;
  percentage: number;
  techniques: string[];  // Technique IDs in this tactic
}

export interface RunResult {
  // Metadata
  id: string;
  model: string;
  modelVersion: string;
  challenge: string;
  startTime: Date;
  endTime: Date;

  // Results
  success: boolean;
  flag: string | null;

  /** Error message when run failed (e.g. rate limit exhausted) - enables proper error reporting instead of "no result file" */
  error?: string;

  // Aggregate Metrics
  totalTime: number;       // seconds
  iterations: number;
  tokens: TokenUsage;

  // Attack Path
  steps: Step[];

  // MITRE ATT&CK Analysis (new)
  techniquesUsed: AttackTechnique[];
  tacticBreakdown: Record<string, TacticBreakdown>;

  // Legacy Analysis (deprecated, kept for backwards compat)
  methodologies: string[];
  toolsUsed: string[];
  methodologyBreakdown: Record<string, { count: number; percentage: number }>;
}

export interface RunConfig {
  model: 'claude' | 'grok';
  challenge: string;
  maxIterations: number;
  containerName: string;
  targetUrl: string;
}

// =============================================================================
// Enterprise LLM Analysis Types
// =============================================================================

export interface AttackPhase {
  phase: string;                    // Kill chain phase name
  stepRange: [number, number];      // Start and end step indices
  description: string;              // What happened in this phase
  techniques: string[];             // MITRE technique IDs used
}

export interface EnrichedTechnique {
  id: string;                       // MITRE ID (e.g., "T1190")
  name: string;                     // Technique name
  tactic: string;                   // Primary tactic
  description: string;              // How it was used in this attack
  stepsUsed: number[];              // Which steps used this technique
  confidence: number;               // 0-100 confidence in classification
}

export interface AnalysisResult {
  // Metadata
  runId: string;
  analyzedAt: Date;
  analyzerModel: string;

  // MITRE ATT&CK Mapping (enriched)
  attackChain: {
    phases: AttackPhase[];
    techniques: EnrichedTechnique[];
    killChainCoverage: string[];    // Which kill chain phases were touched
  };

  // Attack Narrative
  narrative: {
    summary: string;                // 2-3 sentence executive summary
    detailed: string;               // Full attack story
    keyFindings: string[];          // Bullet points
  };

  // Behavioral Analysis
  behavior: {
    approach: 'methodical' | 'aggressive' | 'exploratory' | 'targeted';
    approachDescription: string;    // Why this classification
    strengths: string[];            // What the AI did well
    inefficiencies: string[];       // Wasted steps, dead ends
    decisionQuality: number;        // 0-100 score
  };

  // Strategy Assessment (legacy weighted scoring)
  strategy: {
    reconQuality: number;           // 0-100: How thorough was recon?
    exploitEfficiency: number;      // 0-100: Steps to exploit vs total
    adaptability: number;           // 0-100: How well did it pivot?
    overallScore: number;           // 0-100: Composite score
    scoreBreakdown: string;         // Explanation of scoring
  };

  // NEW: Rubric-based standardized score (when challenge has rubric)
  rubricScore?: RubricScore;
}

export interface EnrichedRunResult extends RunResult {
  analysis?: AnalysisResult;
}

// =============================================================================
// Challenge Rubric & Scoring Types
// =============================================================================

export interface Milestone {
  id: string;                       // e.g., "recon", "vuln_id", "auth_bypass"
  name: string;                     // Display name
  points: number;                   // Points awarded
  criteria: string;                 // What constitutes achievement
  order: number;                    // Sequence in attack chain
}

export interface TimeBonusConfig {
  maxPoints: number;                // Maximum bonus points
  targetSeconds: number;            // Time to get full bonus
  decayRate: number;                // Points lost per second over target
}

export interface EfficiencyBonusConfig {
  maxPoints: number;                // Maximum bonus points
  optimalSteps: number;             // Steps for full bonus
  penaltyPerStep: number;           // Points lost per extra step
}

export interface QualitativeCriteria {
  maxPoints: number;                // Max points for this category
  criteria: string;                 // Description for LLM to evaluate against
}

export interface PenaltyConfig {
  excessiveFailures: { threshold: number; penalty: number };
  offTargetActivity: { penalty: number };
  bruteForce: { penalty: number };
}

export interface ChallengeScoring {
  version: string;                  // Rubric version (e.g., "1.0.0")

  // Objective metrics (calculated, not LLM-judged)
  objective: {
    flagCapture: number;            // Points for getting the flag
    timeBonus: TimeBonusConfig;
    efficiencyBonus: EfficiencyBonusConfig;
  };

  // Milestones for partial credit
  milestones: Milestone[];

  // LLM-evaluated with rubric guidance
  qualitative: {
    reconQuality: QualitativeCriteria;
    techniqueSelection: QualitativeCriteria;
    adaptability: QualitativeCriteria;
  };

  // Penalties
  penalties: PenaltyConfig;
}

export interface ExpectedApproach {
  vulnerabilityType: string[];      // e.g., ["SQL Injection", "Auth Bypass"]
  owaspCategory: string[];          // e.g., ["A03:2021-Injection"]
  expectedTechniques: string[];     // MITRE technique IDs
  optimalPath: string;              // Description of ideal approach
  alternativePaths: string[];       // Valid alternative approaches
  antiPatterns: string[];           // What NOT to do
}

export interface ChallengeMetadata {
  estimatedTime: [number, number];  // [min, max] seconds
  estimatedSteps: [number, number]; // [min, max] steps
  skillLevel: 'junior' | 'mid' | 'senior' | 'expert';
  realWorldRelevance: string;
}

export interface ChallengeConfig {
  // Existing fields
  id: string;
  name: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  target: string;
  flagFormat: string;
  description: string;
  containerName: string;

  // NEW: Scoring rubric
  scoring?: ChallengeScoring;

  // NEW: Expected solution guidance
  expectedApproach?: ExpectedApproach;

  // NEW: Metadata for normalization
  metadata?: ChallengeMetadata;
}

// =============================================================================
// Rubric-Based Score (extends AnalysisResult)
// =============================================================================

export interface MilestoneResult {
  id: string;
  name: string;
  achieved: boolean;
  points: number;                   // Points earned (0 if not achieved)
  reasoning: string;                // Why it was/wasn't achieved
}

export interface QualitativeScore {
  score: number;
  maxPoints: number;
  reasoning: string;
}

export interface AppliedPenalty {
  type: 'excessiveFailures' | 'offTargetActivity' | 'bruteForce' | 'custom';
  points: number;                   // Negative number
  reason: string;
}

export interface RubricScore {
  version: string;                  // Rubric version used

  objective: {
    flagCapture: number;            // Points earned (0 or max)
    timeBonus: number;              // Calculated bonus
    efficiencyBonus: number;        // Calculated bonus
    subtotal: number;
  };

  milestones: {
    results: MilestoneResult[];     // Individual milestone results
    achieved: string[];             // IDs of achieved milestones
    points: number;                 // Total milestone points
  };

  qualitative: {
    reconQuality: QualitativeScore;
    techniqueSelection: QualitativeScore;
    adaptability: QualitativeScore;
    subtotal: number;
  };

  penalties: {
    applied: AppliedPenalty[];
    subtotal: number;               // Negative total
  };

  total: number;                    // Final rubric score (0-100, capped)
  maxPossible: number;              // Maximum possible score
  percentage: number;               // total / maxPossible * 100
}
