// OASIS Harness Runner — opt-in eval harness with verify-before-claim, budget tracking, and findings

import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  HarnessConfig,
  BudgetStatus,
  FindingsReport,
  CoverageLedger,
  Finding,
  ConfirmedFinding,
  NeedsValidationFinding,
  HarnessRunResult,
  VerificationEntry,
  CoverageUnit,
} from './types.js';
import type { RunResult, Step } from '../lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Configuration & Environment
// =============================================================================

/**
 * Load harness configuration from environment variables and defaults.
 */
export function loadHarnessConfig(): HarnessConfig {
  const enabled = process.env.OASIS_HARNESS === 'true' || process.env.OASIS_HARNESS === '1';
  
  if (!enabled) {
    return {
      enabled: false,
      mode: 'single-model',
      budget: { hardStop: false },
      verifyBeforeClaim: false,
      coverageLedger: false,
    };
  }
  
  return {
    enabled: true,
    mode: (process.env.OASIS_HARNESS_MODE as 'single-model' | 'kbot-fleet') || 'single-model',
    budget: {
      maxSteps: process.env.OASIS_HARNESS_MAX_STEPS ? parseInt(process.env.OASIS_HARNESS_MAX_STEPS, 10) : undefined,
      maxTokens: process.env.OASIS_HARNESS_MAX_TOKENS ? parseInt(process.env.OASIS_HARNESS_MAX_TOKENS, 10) : undefined,
      maxTimeSeconds: process.env.OASIS_HARNESS_MAX_TIME ? parseInt(process.env.OASIS_HARNESS_MAX_TIME, 10) : undefined,
      hardStop: process.env.OASIS_HARNESS_HARD_STOP === 'true' || process.env.OASIS_HARNESS_HARD_STOP === '1',
    },
    verifyBeforeClaim: process.env.OASIS_HARNESS_VERIFY !== 'false',
    coverageLedger: process.env.OASIS_HARNESS_COVERAGE === 'true' || process.env.OASIS_HARNESS_COVERAGE === '1',
    outputDir: process.env.OASIS_HARNESS_OUTPUT_DIR,
  };
}

// =============================================================================
// Budget Tracking
// =============================================================================

export function trackBudget(result: RunResult, config: HarnessConfig): BudgetStatus {
  const budget: BudgetStatus = {
    steps: {
      used: result.iterations,
      limit: config.budget.maxSteps,
      exceeded: false,
    },
    tokens: {
      used: result.tokens.total,
      limit: config.budget.maxTokens,
      exceeded: false,
    },
    timeSeconds: {
      used: result.totalTime,
      limit: config.budget.maxTimeSeconds,
      exceeded: false,
    },
    overallExceeded: false,
  };
  
  if (budget.steps.limit && budget.steps.used >= budget.steps.limit) {
    budget.steps.exceeded = true;
    budget.overallExceeded = true;
  }
  
  if (budget.tokens.limit && budget.tokens.used >= budget.tokens.limit) {
    budget.tokens.exceeded = true;
    budget.overallExceeded = true;
  }
  
  if (budget.timeSeconds.limit && budget.timeSeconds.used >= budget.timeSeconds.limit) {
    budget.timeSeconds.exceeded = true;
    budget.overallExceeded = true;
  }
  
  return budget;
}

/**
 * Check if budget is exceeded during a run (for early stopping).
 */
export function checkBudgetExceeded(
  iterations: number,
  totalTokens: number,
  elapsedSeconds: number,
  config: HarnessConfig
): { exceeded: boolean; reason?: string } {
  if (!config.budget.hardStop) {
    return { exceeded: false };
  }
  
  if (config.budget.maxSteps && iterations >= config.budget.maxSteps) {
    return { exceeded: true, reason: `Step budget exceeded (${iterations}/${config.budget.maxSteps})` };
  }
  
  if (config.budget.maxTokens && totalTokens >= config.budget.maxTokens) {
    return { exceeded: true, reason: `Token budget exceeded (${totalTokens}/${config.budget.maxTokens})` };
  }
  
  if (config.budget.maxTimeSeconds && elapsedSeconds >= config.budget.maxTimeSeconds) {
    return { exceeded: true, reason: `Time budget exceeded (${elapsedSeconds.toFixed(1)}s/${config.budget.maxTimeSeconds}s)` };
  }
  
  return { exceeded: false };
}

// =============================================================================
// Findings Generation
// =============================================================================

/**
 * Generate findings from a RunResult.
 * In harness mode, findings start as needs_validation until verified.
 */
export function generateFindings(
  result: RunResult,
  config: HarnessConfig
): FindingsReport {
  const findings: Finding[] = [];
  
  // If flag was captured, create a finding for it
  if (result.flag && result.success) {
    const flagSteps = result.steps
      .filter(s => s.output?.includes(result.flag!))
      .map(s => s.iteration);
    
    const flagCommands = result.steps
      .filter(s => s.output?.includes(result.flag!))
      .map(s => s.command)
      .filter((c): c is string => !!c);
    
    if (flagSteps.length > 0 && flagCommands.length > 0) {
      const finding: NeedsValidationFinding = {
        id: `FND-${result.id}-001`,
        verdict: 'needs_validation',
        title: 'Flag Capture',
        category: inferCategoryFromChallenge(result.challenge),
        owaspCategory: inferOwaspFromChallenge(result.challenge),
        trace: {
          steps: flagSteps,
          commands: flagCommands,
        },
        reason: config.verifyBeforeClaim
          ? 'Requires independent verification before confirmation'
          : 'Flag captured, pending verification',
        discoveredBy: `${result.model}:${result.modelVersion}`,
      };
      
      findings.push(finding);
    }
  }
  
  // Additional findings could be extracted from:
  // - steps with specific technique classifications
  // - patterns in command/output pairs
  // - MITRE ATT&CK techniques used
  // This is a basic implementation; Track B (kBot) would have richer finding extraction
  
  return {
    version: '1.0.0',
    runId: result.id,
    challenge: result.challenge,
    timestamp: new Date().toISOString(),
    harnessMode: config.mode,
    findings,
  };
}

function inferCategoryFromChallenge(challengeId: string) {
  const lower = challengeId.toLowerCase();
  
  if (lower.includes('sqli') || lower.includes('sql-injection')) return 'sql-injection';
  if (lower.includes('command-injection') || lower.includes('cmdi')) return 'command-injection';
  if (lower.includes('auth-bypass') || lower.includes('authentication')) return 'auth-bypass';
  if (lower.includes('idor')) return 'idor';
  if (lower.includes('xxe')) return 'xxe';
  if (lower.includes('ssrf')) return 'ssrf';
  if (lower.includes('path-traversal') || lower.includes('lfi')) return 'path-traversal';
  if (lower.includes('deserialization')) return 'deserialization';
  if (lower.includes('jwt')) return 'jwt-forgery';
  if (lower.includes('session')) return 'session-hijack';
  if (lower.includes('rce')) return 'rce';
  
  return 'other';
}

function inferOwaspFromChallenge(challengeId: string) {
  const category = inferCategoryFromChallenge(challengeId);
  
  const owaspMap: Record<string, string> = {
    'sql-injection': 'A03:2021 - Injection',
    'command-injection': 'A03:2021 - Injection',
    'auth-bypass': 'A07:2021 - Identification and Authentication Failures',
    'idor': 'A01:2021 - Broken Access Control',
    'xxe': 'A05:2021 - Security Misconfiguration',
    'ssrf': 'A10:2021 - Server-Side Request Forgery',
    'path-traversal': 'A01:2021 - Broken Access Control',
    'deserialization': 'A08:2021 - Software and Data Integrity Failures',
    'jwt-forgery': 'A02:2021 - Cryptographic Failures',
    'session-hijack': 'A07:2021 - Identification and Authentication Failures',
    'rce': 'A03:2021 - Injection',
    'info-disclosure': 'A01:2021 - Broken Access Control',
  };
  
  return owaspMap[category] || 'A06:2021 - Vulnerable and Outdated Components';
}

// =============================================================================
// Coverage Ledger
// =============================================================================

/**
 * Generate a coverage ledger from a RunResult.
 * Tracks which attack surfaces were explored vs. guessed.
 */
export function generateCoverageLedger(
  result: RunResult,
  config: HarnessConfig
): CoverageLedger {
  const units: CoverageUnit[] = [];
  
  // Define standard attack surfaces for CTF challenges
  const surfaces = [
    'reconnaissance',
    'authentication',
    'authorization',
    'input-validation',
    'injection-vectors',
    'session-management',
    'data-access',
    'api-endpoints',
  ];
  
  // Map steps to surfaces based on techniques and methodologies
  for (const surface of surfaces) {
    const relatedSteps = result.steps.filter(step => 
      isStepRelatedToSurface(step, surface)
    );
    
    if (relatedSteps.length > 0) {
      const techniques = [...new Set(
        relatedSteps
          .map(s => s.technique?.id)
          .filter((t): t is string => !!t)
      )];
      
      const findingIds = surface === 'data-access' && result.flag
        ? [`FND-${result.id}-001`]
        : [];
      
      units.push({
        id: `COV-${surface}`,
        name: surface.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
        description: `Coverage for ${surface} attack surface`,
        surface,
        state: 'completed',
        assignedTo: `${result.model}:${result.modelVersion}`,
        startedAt: relatedSteps[0].timestamp.toISOString(),
        completedAt: relatedSteps[relatedSteps.length - 1].timestamp.toISOString(),
        findingIds,
        techniques,
      });
    } else {
      // Surface not explored
      units.push({
        id: `COV-${surface}`,
        name: surface.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
        description: `Coverage for ${surface} attack surface`,
        surface,
        state: 'planned',
        findingIds: [],
        techniques: [],
      });
    }
  }
  
  const summary = {
    planned: units.filter(u => u.state === 'planned').length,
    inProgress: units.filter(u => u.state === 'in_progress').length,
    completed: units.filter(u => u.state === 'completed').length,
    deferred: units.filter(u => u.state === 'deferred').length,
  };
  
  return {
    version: '1.0.0',
    runId: result.id,
    challenge: result.challenge,
    timestamp: new Date().toISOString(),
    units,
    summary,
  };
}

function isStepRelatedToSurface(step: Step, surface: string): boolean {
  const methodology = step.methodology?.toLowerCase() || '';
  const command = step.command?.toLowerCase() || '';
  const reasoning = step.reasoning?.toLowerCase() || '';
  
  switch (surface) {
    case 'reconnaissance':
      return methodology === 'reconnaissance' || 
             command.includes('nmap') || 
             command.includes('curl') ||
             reasoning.includes('recon') ||
             reasoning.includes('enumerate');
    
    case 'authentication':
      return command.includes('login') ||
             command.includes('auth') ||
             reasoning.includes('authentication') ||
             reasoning.includes('credentials');
    
    case 'authorization':
      return reasoning.includes('access control') ||
             reasoning.includes('authorization') ||
             reasoning.includes('privilege');
    
    case 'input-validation':
      return methodology === 'vulnerability scanning' ||
             reasoning.includes('input') ||
             reasoning.includes('validation');
    
    case 'injection-vectors':
      return methodology === 'exploitation' ||
             command.includes('sqlmap') ||
             reasoning.includes('injection') ||
             reasoning.includes('payload');
    
    case 'session-management':
      return command.includes('cookie') ||
             command.includes('session') ||
             reasoning.includes('session');
    
    case 'data-access':
      return methodology === 'data exfiltration' ||
             command.includes('cat') ||
             command.includes('flag') ||
             reasoning.includes('data') ||
             reasoning.includes('flag');
    
    case 'api-endpoints':
      return command.includes('curl') ||
             command.includes('wget') ||
             reasoning.includes('endpoint') ||
             reasoning.includes('api');
    
    default:
      return false;
  }
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate findings.json using the zero-dep validator.
 */
export function validateFindings(findingsPath: string): { valid: boolean; output: string } {
  const validatorPath = resolve(__dirname, '../../spec/harness/validate-findings.cjs');
  
  try {
    const output = execFileSync('node', [validatorPath, findingsPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { valid: true, output };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    return { valid: false, output: err.stdout || err.stderr || 'Validation failed' };
  }
}

/**
 * Validate coverage-ledger.json using the zero-dep validator.
 */
export function validateCoverageLedger(ledgerPath: string): { valid: boolean; output: string } {
  const validatorPath = resolve(__dirname, '../../spec/harness/validate-coverage-ledger.cjs');
  
  try {
    const output = execFileSync('node', [validatorPath, ledgerPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { valid: true, output };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    return { valid: false, output: err.stdout || err.stderr || 'Validation failed' };
  }
}

// =============================================================================
// Harness Result Persistence
// =============================================================================

export function saveHarnessResult(
  result: RunResult,
  harnessResult: HarnessRunResult,
  outputDir: string
): { findingsPath: string; ledgerPath?: string; harnessPath: string } {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  // Save findings
  const findingsPath = resolve(outputDir, `${result.id}.findings.json`);
  writeFileSync(findingsPath, JSON.stringify(harnessResult.findings, null, 2), { mode: 0o600 });
  
  // Validate findings
  const findingsValidation = validateFindings(findingsPath);
  if (!findingsValidation.valid) {
    console.warn(`Warning: findings.json validation failed:\n${findingsValidation.output}`);
  }
  
  // Save coverage ledger if enabled
  let ledgerPath: string | undefined;
  if (harnessResult.coverageLedger) {
    ledgerPath = resolve(outputDir, `${result.id}.coverage-ledger.json`);
    writeFileSync(ledgerPath, JSON.stringify(harnessResult.coverageLedger, null, 2), { mode: 0o600 });
    
    const ledgerValidation = validateCoverageLedger(ledgerPath);
    if (!ledgerValidation.valid) {
      console.warn(`Warning: coverage-ledger.json validation failed:\n${ledgerValidation.output}`);
    }
  }
  
  // Save full harness result
  const harnessPath = resolve(outputDir, `${result.id}.harness.json`);
  const harnessData = {
    ...harnessResult,
    startTime: harnessResult.startTime.toISOString(),
    endTime: harnessResult.endTime.toISOString(),
    verificationLog: harnessResult.verificationLog?.map(entry => ({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    })),
  };
  writeFileSync(harnessPath, JSON.stringify(harnessData, null, 2), { mode: 0o600 });
  
  return { findingsPath, ledgerPath, harnessPath };
}

// =============================================================================
// Main Harness Integration
// =============================================================================

/**
 * Process a RunResult through the harness to generate findings and coverage.
 * Called after a benchmark run completes when harness mode is enabled.
 */
export function processHarnessResult(
  result: RunResult,
  config: HarnessConfig,
  outputDir: string
): HarnessRunResult {
  const findings = generateFindings(result, config);
  const coverageLedger = config.coverageLedger ? generateCoverageLedger(result, config) : undefined;
  const budget = trackBudget(result, config);
  
  const harnessResult: HarnessRunResult = {
    runId: result.id,
    challenge: result.challenge,
    harnessConfig: config,
    startTime: result.startTime,
    endTime: result.endTime,
    budget,
    findings,
    coverageLedger,
    verificationLog: generateVerificationLog(result, findings),
  };
  
  const paths = saveHarnessResult(result, harnessResult, outputDir);
  
  return harnessResult;
}

function generateVerificationLog(result: RunResult, findings: FindingsReport): VerificationEntry[] {
  const log: VerificationEntry[] = [];
  
  for (const finding of findings.findings) {
    if (finding.verdict === 'needs_validation') {
      log.push({
        timestamp: new Date(finding.trace.steps.length > 0 
          ? result.steps[finding.trace.steps[0] - 1]?.timestamp || result.startTime
          : result.startTime
        ),
        findingId: finding.id,
        verifier: finding.discoveredBy,
        action: 'discovered',
        reason: 'Found during benchmark execution',
      });
    }
  }
  
  return log;
}
