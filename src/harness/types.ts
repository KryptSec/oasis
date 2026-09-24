// OASIS Harness Types — eval harness + scoring protocol for single-model and fleet runs

// =============================================================================
// Harness Configuration
// =============================================================================

export interface HarnessConfig {
  enabled: boolean;
  mode: 'single-model' | 'kbot-fleet';
  budget: BudgetConfig;
  verifyBeforeClaim: boolean;
  coverageLedger: boolean;
  outputDir?: string;
}

export interface BudgetConfig {
  maxSteps?: number;
  maxTokens?: number;
  maxTimeSeconds?: number;
  hardStop: boolean;  // If true, stop immediately on budget exceeded
}

// =============================================================================
// Findings Types (matches findings-schema.json)
// =============================================================================

export type FindingVerdict = 'confirmed' | 'needs_validation' | 'rejected';

export type VulnerabilityCategory =
  | 'sql-injection'
  | 'command-injection'
  | 'auth-bypass'
  | 'idor'
  | 'xxe'
  | 'ssrf'
  | 'path-traversal'
  | 'deserialization'
  | 'crypto-failure'
  | 'jwt-forgery'
  | 'session-hijack'
  | 'info-disclosure'
  | 'privilege-escalation'
  | 'rce'
  | 'other';

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type SeverityLevel = 'informational' | 'low' | 'medium' | 'high' | 'critical';

export interface FindingTrace {
  steps: number[];
  commands: string[];
  endpoints?: string[];
}

export interface FindingExecution {
  payload: string;
  method?: string;
  proofOutput: string;
}

export interface FindingConfidence {
  level: ConfidenceLevel;
  reason: string;
}

export interface FindingSeverity {
  likelihood: SeverityLevel;
  impact: SeverityLevel;
  overallSeverity: SeverityLevel;
}

export interface ConfirmedFinding {
  id: string;
  verdict: 'confirmed';
  title: string;
  category: VulnerabilityCategory;
  owaspCategory: string;
  trace: FindingTrace;
  execution: FindingExecution;
  intendedBehavior: string;
  confidence: FindingConfidence;
  severity: FindingSeverity;
  remediation: string;
  verifiedBy: string;
  verifiedAt: string;
}

export interface NeedsValidationFinding {
  id: string;
  verdict: 'needs_validation';
  title: string;
  category: VulnerabilityCategory;
  owaspCategory?: string;
  trace: Partial<FindingTrace> & { steps: number[] };
  reason: string;
  discoveredBy: string;
}

export interface RejectedFinding {
  id: string;
  verdict: 'rejected';
  title: string;
  category: VulnerabilityCategory;
  reason: string;
  rejectedBy: string;
  rejectedAt: string;
}

export type Finding = ConfirmedFinding | NeedsValidationFinding | RejectedFinding;

export interface FindingsReport {
  version: '1.0.0';
  runId: string;
  challenge: string;
  timestamp: string;
  harnessMode: 'single-model' | 'kbot-fleet';
  findings: Finding[];
}

// =============================================================================
// Coverage Ledger Types
// =============================================================================

export type CoverageUnitState = 'planned' | 'in_progress' | 'completed' | 'deferred';

export interface CoverageUnit {
  id: string;
  name: string;
  description: string;
  surface: string;  // e.g., 'auth', 'api-endpoints', 'injection-vectors', 'session-mgmt'
  state: CoverageUnitState;
  assignedTo?: string;  // agent/role ID
  startedAt?: string;
  completedAt?: string;
  findingIds: string[];  // References to findings from this unit
  techniques: string[];  // MITRE ATT&CK techniques applied
  deferredReason?: string;
}

export interface CoverageLedger {
  version: '1.0.0';
  runId: string;
  challenge: string;
  timestamp: string;
  units: CoverageUnit[];
  summary: {
    planned: number;
    inProgress: number;
    completed: number;
    deferred: number;
  };
}

// =============================================================================
// Budget Tracking
// =============================================================================

export interface BudgetStatus {
  steps: {
    used: number;
    limit?: number;
    exceeded: boolean;
  };
  tokens: {
    used: number;
    limit?: number;
    exceeded: boolean;
  };
  timeSeconds: {
    used: number;
    limit?: number;
    exceeded: boolean;
  };
  overallExceeded: boolean;
}

// =============================================================================
// Harness Run Result
// =============================================================================

export interface HarnessRunResult {
  runId: string;
  challenge: string;
  harnessConfig: HarnessConfig;
  startTime: Date;
  endTime: Date;
  budget: BudgetStatus;
  findings: FindingsReport;
  coverageLedger?: CoverageLedger;
  verificationLog?: VerificationEntry[];
}

export interface VerificationEntry {
  timestamp: Date;
  findingId: string;
  verifier: string;  // 'hunter' | 'verifier' | agent ID
  action: 'discovered' | 'verified' | 'rejected' | 'needs_review';
  reason: string;
}

// =============================================================================
// kBot Adapter Interface (for Track B integration)
// =============================================================================

export interface KBotEpisodeAdapter {
  episodeId: string;
  challenge: string;
  
  /**
   * Transform kBot episode output (role agent transcripts, memory, handoffs)
   * into standardized FindingsReport format.
   */
  toFindings(): Promise<FindingsReport>;
  
  /**
   * Build coverage ledger from kBot role assignments and episode memory.
   */
  toCoverageLedger(): Promise<CoverageLedger>;
  
  /**
   * Extract budget status from kBot episode metrics.
   */
  getBudgetStatus(): BudgetStatus;
  
  /**
   * Get verification log from kBot independent review loops.
   */
  getVerificationLog(): VerificationEntry[];
}

// Note: Actual kBot adapter implementation is Track B / pending SCM access.
// This interface defines the contract for fleet → harness scoring integration.
