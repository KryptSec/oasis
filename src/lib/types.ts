// OASIS Type Definitions
// Core types for benchmark runs, analysis, scoring, and challenges

// =============================================================================
// MITRE ATT&CK Types
// =============================================================================

export interface AttackTechnique {
  id: string;           // e.g., "T1190"
  name: string;         // e.g., "Exploit Public-Facing Application"
  tactic: string;       // e.g., "Initial Access"
  url: string;          // Link to attack.mitre.org
}

export type Tactic =
  | 'Reconnaissance'
  | 'Resource Development'
  | 'Initial Access'
  | 'Execution'
  | 'Persistence'
  | 'Privilege Escalation'
  | 'Defense Evasion'
  | 'Credential Access'
  | 'Discovery'
  | 'Lateral Movement'
  | 'Collection'
  | 'Command and Control'
  | 'Exfiltration'
  | 'Impact'
  | 'Agent Preparation';

export type Methodology =
  | 'Reconnaissance'
  | 'Vulnerability Scanning'
  | 'Exploitation'
  | 'Privilege Escalation'
  | 'Data Exfiltration'
  | 'Post-Exploitation'
  | 'Authenticated Access'
  | 'Agent Environment'
  | 'Unknown';

// =============================================================================
// Run Types
// =============================================================================

export interface Step {
  iteration: number;
  timestamp: Date;
  duration: number;        // ms since last step
  reasoning: string;       // What the AI said before acting
  type: 'tool_call' | 'text';
  command?: string;
  output?: string;
  technique?: AttackTechnique | null;
  methodology?: Methodology;
  tool?: string;
  success?: boolean;
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
  techniques: string[];
}

export interface RunResult {
  id: string;
  model: string;
  modelVersion: string;
  challenge: string;
  startTime: Date;
  endTime: Date;
  success: boolean;
  flag: string | null;
  totalTime: number;       // seconds
  iterations: number;
  tokens: TokenUsage;
  steps: Step[];
  techniquesUsed: AttackTechnique[];
  tacticBreakdown: Record<string, TacticBreakdown>;
  methodologies: string[];
  toolsUsed: string[];
  methodologyBreakdown: Record<string, { count: number; percentage: number }>;
  error?: string | null;
}

// =============================================================================
// Analysis Types
// =============================================================================

export interface AttackPhase {
  phase: string;
  stepRange: [number, number];
  description: string;
  techniques: string[];
}

export interface EnrichedTechnique {
  id: string;
  name: string;
  tactic: string;
  description: string;
  stepsUsed: number[];
  confidence: number;
}

export interface AnalysisResult {
  runId: string;
  analyzedAt: Date;
  analyzerModel: string;
  attackChain: {
    phases: AttackPhase[];
    techniques: EnrichedTechnique[];
    killChainCoverage: string[];
  };
  narrative: {
    summary: string;
    detailed: string;
    keyFindings: string[];
  };
  behavior: {
    approach: 'methodical' | 'aggressive' | 'exploratory' | 'targeted';
    approachDescription: string;
    strengths: string[];
    inefficiencies: string[];
    decisionQuality: number;
  };
  strategy: {
    reconQuality: number;
    exploitEfficiency: number;
    adaptability: number;
    overallScore: number;
    scoreBreakdown: string;
  };
  rubricScore?: RubricScore;
}

// =============================================================================
// Challenge & Scoring Types
// =============================================================================

export interface Milestone {
  id: string;
  name: string;
  points: number;
  criteria: string;
  order: number;
}

export interface TimeBonusConfig {
  maxPoints: number;
  targetSeconds: number;
  decayRate: number;
}

export interface EfficiencyBonusConfig {
  maxPoints: number;
  optimalSteps: number;
  penaltyPerStep: number;
}

export interface QualitativeCriteria {
  maxPoints: number;
  criteria: string;
}

export interface PenaltyConfig {
  excessiveFailures: { threshold: number; penalty: number };
  offTargetActivity: { penalty: number };
  bruteForce: { penalty: number };
}

export interface ChallengeScoring {
  version: string;
  objective: {
    flagCapture: number;
    timeBonus: TimeBonusConfig;
    efficiencyBonus: EfficiencyBonusConfig;
  };
  milestones: Milestone[];
  qualitative: {
    reconQuality: QualitativeCriteria;
    techniqueSelection: QualitativeCriteria;
    adaptability: QualitativeCriteria;
  };
  penalties: PenaltyConfig;
}

export interface ExpectedApproach {
  vulnerabilityType: string[];
  owaspCategory: string[];
  expectedTechniques: string[];
  optimalPath: string;
  alternativePaths: string[];
  antiPatterns: string[];
}

export interface ChallengeMetadata {
  estimatedTime: [number, number];
  estimatedSteps: [number, number];
  skillLevel: 'junior' | 'mid' | 'senior' | 'expert';
  realWorldRelevance: string;
}

export interface ChallengeConfig {
  id: string;
  name: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  target: string;
  flagFormat: string;
  description: string;
  containerName: string;
  limits?: {
    expectedIterations?: number;
    maxIterations: number;
    maxTimeSeconds: number;
  };
  scoring?: ChallengeScoring;
  expectedApproach?: ExpectedApproach;
  metadata?: ChallengeMetadata;
}

// =============================================================================
// Rubric Score Types
// =============================================================================

export interface MilestoneResult {
  id: string;
  name: string;
  achieved: boolean;
  points: number;
  reasoning: string;
}

export interface QualitativeScore {
  score: number;
  maxPoints: number;
  reasoning: string;
}

export interface AppliedPenalty {
  type: 'excessiveFailures' | 'offTargetActivity' | 'bruteForce' | 'custom';
  points: number;
  reason: string;
}

export interface RubricScore {
  version: string;
  objective: {
    flagCapture: number;
    timeBonus: number;
    efficiencyBonus: number;
    subtotal: number;
  };
  milestones: {
    results: MilestoneResult[];
    achieved: string[];
    points: number;
  };
  qualitative: {
    reconQuality: QualitativeScore;
    techniqueSelection: QualitativeScore;
    adaptability: QualitativeScore;
    subtotal: number;
  };
  penalties: {
    applied: AppliedPenalty[];
    subtotal: number;
  };
  total: number;
  maxPossible: number;
  percentage: number;
}

// =============================================================================
// Runner Config Types
// =============================================================================

export interface RunnerConfig {
  provider: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  challenge: ChallengeConfig;
  challengeDir: string;
  maxIterations?: number;
  analyze?: boolean;
  analyzerModel?: string;
  analyzerApiKey?: string;
  verbose?: boolean;
  onProgress?: (phase: string) => void;
}
