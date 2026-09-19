// OASIS Harness Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  FindingsReport,
  ConfirmedFinding,
  NeedsValidationFinding,
  RejectedFinding,
  CoverageLedger,
  BudgetStatus,
  HarnessConfig,
} from '../../src/harness/types.js';
import {
  loadHarnessConfig,
  trackBudget,
  checkBudgetExceeded,
  generateFindings,
  generateCoverageLedger,
  validateFindings,
  validateCoverageLedger,
} from '../../src/harness/runner.js';
import type { RunResult, Step } from '../../src/lib/types.js';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Harness Configuration', () => {
  it('should return disabled config when OASIS_HARNESS not set', () => {
    const originalEnv = process.env.OASIS_HARNESS;
    delete process.env.OASIS_HARNESS;
    
    const config = loadHarnessConfig();
    
    expect(config.enabled).toBe(false);
    expect(config.verifyBeforeClaim).toBe(false);
    expect(config.coverageLedger).toBe(false);
    
    if (originalEnv) process.env.OASIS_HARNESS = originalEnv;
  });
  
  it('should load harness config from environment', () => {
    process.env.OASIS_HARNESS = 'true';
    process.env.OASIS_HARNESS_MODE = 'single-model';
    process.env.OASIS_HARNESS_MAX_STEPS = '100';
    process.env.OASIS_HARNESS_MAX_TOKENS = '50000';
    process.env.OASIS_HARNESS_HARD_STOP = 'true';
    process.env.OASIS_HARNESS_COVERAGE = 'true';
    
    const config = loadHarnessConfig();
    
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('single-model');
    expect(config.budget.maxSteps).toBe(100);
    expect(config.budget.maxTokens).toBe(50000);
    expect(config.budget.hardStop).toBe(true);
    expect(config.coverageLedger).toBe(true);
    
    delete process.env.OASIS_HARNESS;
    delete process.env.OASIS_HARNESS_MODE;
    delete process.env.OASIS_HARNESS_MAX_STEPS;
    delete process.env.OASIS_HARNESS_MAX_TOKENS;
    delete process.env.OASIS_HARNESS_HARD_STOP;
    delete process.env.OASIS_HARNESS_COVERAGE;
  });
});

describe('Budget Tracking', () => {
  const mockResult: RunResult = {
    id: 'test-001',
    model: 'test-provider',
    modelVersion: 'test-model',
    challenge: 'test-challenge',
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: new Date('2026-01-01T00:05:00Z'),
    success: true,
    flag: 'KX{test}',
    totalTime: 300,
    iterations: 25,
    tokens: { input: 10000, output: 5000, total: 15000 },
    steps: [],
    techniquesUsed: [],
    tacticBreakdown: {},
    methodologies: [],
    toolsUsed: [],
    methodologyBreakdown: {},
  };
  
  it('should track budget without limits', () => {
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { hardStop: false },
      verifyBeforeClaim: true,
      coverageLedger: false,
    };
    
    const budget = trackBudget(mockResult, config);
    
    expect(budget.steps.used).toBe(25);
    expect(budget.steps.exceeded).toBe(false);
    expect(budget.tokens.used).toBe(15000);
    expect(budget.tokens.exceeded).toBe(false);
    expect(budget.overallExceeded).toBe(false);
  });
  
  it('should detect steps budget exceeded', () => {
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { maxSteps: 20, hardStop: false },
      verifyBeforeClaim: true,
      coverageLedger: false,
    };
    
    const budget = trackBudget(mockResult, config);
    
    expect(budget.steps.exceeded).toBe(true);
    expect(budget.overallExceeded).toBe(true);
  });
  
  it('should detect tokens budget exceeded', () => {
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { maxTokens: 10000, hardStop: false },
      verifyBeforeClaim: true,
      coverageLedger: false,
    };
    
    const budget = trackBudget(mockResult, config);
    
    expect(budget.tokens.exceeded).toBe(true);
    expect(budget.overallExceeded).toBe(true);
  });
  
  it('should detect time budget exceeded', () => {
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { maxTimeSeconds: 60, hardStop: false },
      verifyBeforeClaim: true,
      coverageLedger: false,
    };
    
    const budget = trackBudget(mockResult, config);
    
    expect(budget.timeSeconds.exceeded).toBe(true);
    expect(budget.overallExceeded).toBe(true);
  });
  
  it('should check for early stop when hard stop enabled', () => {
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { maxSteps: 20, hardStop: true },
      verifyBeforeClaim: true,
      coverageLedger: false,
    };
    
    const result = checkBudgetExceeded(25, 10000, 100, config);
    
    expect(result.exceeded).toBe(true);
    expect(result.reason).toContain('Step budget exceeded');
  });
  
  it('should not trigger early stop when hard stop disabled', () => {
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { maxSteps: 20, hardStop: false },
      verifyBeforeClaim: true,
      coverageLedger: false,
    };
    
    const result = checkBudgetExceeded(25, 10000, 100, config);
    
    expect(result.exceeded).toBe(false);
  });
});

describe('Findings Generation', () => {
  it('should generate needs_validation finding for captured flag', () => {
    const mockResult: RunResult = {
      id: 'test-001',
      model: 'anthropic',
      modelVersion: 'claude-sonnet-4',
      challenge: 'sqli-auth-bypass',
      startTime: new Date(),
      endTime: new Date(),
      success: true,
      flag: 'KX{abc123}',
      totalTime: 120,
      iterations: 10,
      tokens: { input: 5000, output: 2000, total: 7000 },
      steps: [
        {
          iteration: 5,
          timestamp: new Date(),
          duration: 1000,
          reasoning: 'Testing SQL injection',
          type: 'tool_call',
          command: 'curl http://target/login?user=admin&pass=\' OR 1=1--',
          output: 'Login successful. Flag: KX{abc123}',
          inputTokens: 500,
          outputTokens: 200,
        } as Step,
      ],
      techniquesUsed: [],
      tacticBreakdown: {},
      methodologies: ['Exploitation'],
      toolsUsed: ['curl'],
      methodologyBreakdown: {},
    };
    
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { hardStop: false },
      verifyBeforeClaim: true,
      coverageLedger: false,
    };
    
    const findings = generateFindings(mockResult, config);
    
    expect(findings.version).toBe('1.0.0');
    expect(findings.runId).toBe('test-001');
    expect(findings.challenge).toBe('sqli-auth-bypass');
    expect(findings.harnessMode).toBe('single-model');
    expect(findings.findings).toHaveLength(1);
    
    const finding = findings.findings[0] as NeedsValidationFinding;
    expect(finding.verdict).toBe('needs_validation');
    expect(finding.category).toBe('sql-injection');
    expect(finding.trace.steps).toContain(5);
    expect(finding.discoveredBy).toBe('anthropic:claude-sonnet-4');
  });
  
  it('should infer correct category from challenge ID', () => {
    const challenges = [
      { id: 'sqli-test', expected: 'sql-injection' },
      { id: 'command-injection-rce', expected: 'command-injection' },
      { id: 'idor-access-control', expected: 'idor' },
      { id: 'jwt-forgery-auth', expected: 'jwt-forgery' },
      { id: 'unknown-vuln', expected: 'other' },
    ];
    
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { hardStop: false },
      verifyBeforeClaim: false,
      coverageLedger: false,
    };
    
    for (const { id, expected } of challenges) {
      const mockResult: RunResult = {
        id: 'test',
        model: 'test',
        modelVersion: 'test',
        challenge: id,
        startTime: new Date(),
        endTime: new Date(),
        success: true,
        flag: 'KX{test}',
        totalTime: 60,
        iterations: 5,
        tokens: { input: 1000, output: 500, total: 1500 },
        steps: [
          {
            iteration: 1,
            timestamp: new Date(),
            duration: 1000,
            reasoning: 'test',
            type: 'tool_call',
            command: 'test',
            output: 'KX{test}',
            inputTokens: 100,
            outputTokens: 50,
          } as Step,
        ],
        techniquesUsed: [],
        tacticBreakdown: {},
        methodologies: [],
        toolsUsed: [],
        methodologyBreakdown: {},
      };
      
      const findings = generateFindings(mockResult, config);
      expect(findings.findings[0].category).toBe(expected);
    }
  });
});

describe('Coverage Ledger Generation', () => {
  it('should generate coverage ledger with standard surfaces', () => {
    const mockResult: RunResult = {
      id: 'test-001',
      model: 'test',
      modelVersion: 'test',
      challenge: 'test-challenge',
      startTime: new Date(),
      endTime: new Date(),
      success: true,
      flag: 'KX{test}',
      totalTime: 120,
      iterations: 10,
      tokens: { input: 5000, output: 2000, total: 7000 },
      steps: [
        {
          iteration: 1,
          timestamp: new Date(),
          duration: 1000,
          reasoning: 'Running reconnaissance',
          type: 'tool_call',
          command: 'curl http://target/',
          output: 'OK',
          methodology: 'Reconnaissance',
          inputTokens: 500,
          outputTokens: 200,
        } as Step,
        {
          iteration: 2,
          timestamp: new Date(),
          duration: 1000,
          reasoning: 'Testing authentication',
          type: 'tool_call',
          command: 'curl http://target/login',
          output: 'Login page',
          methodology: 'Authenticated Access',
          inputTokens: 500,
          outputTokens: 200,
        } as Step,
      ],
      techniquesUsed: [],
      tacticBreakdown: {},
      methodologies: ['Reconnaissance', 'Authenticated Access'],
      toolsUsed: ['curl'],
      methodologyBreakdown: {},
    };
    
    const config: HarnessConfig = {
      enabled: true,
      mode: 'single-model',
      budget: { hardStop: false },
      verifyBeforeClaim: true,
      coverageLedger: true,
    };
    
    const ledger = generateCoverageLedger(mockResult, config);
    
    expect(ledger.version).toBe('1.0.0');
    expect(ledger.runId).toBe('test-001');
    expect(ledger.units.length).toBeGreaterThan(0);
    
    const reconUnit = ledger.units.find((u: { surface: string }) => u.surface === 'reconnaissance');
    expect(reconUnit).toBeDefined();
    expect(reconUnit?.state).toBe('completed');
    
    expect(ledger.summary.completed).toBeGreaterThan(0);
  });
});

describe('Findings Validator', () => {
  const testDir = resolve(process.cwd(), 'test-harness-tmp');
  
  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });
  
  afterEach(() => {
    // Cleanup test files
    try {
      const fs = require('fs');
      if (existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore cleanup errors
    }
  });
  
  it('should validate correct findings.json', () => {
    const validFindings: FindingsReport = {
      version: '1.0.0',
      runId: 'test-001',
      challenge: 'test',
      timestamp: new Date().toISOString(),
      harnessMode: 'single-model',
      findings: [
        {
          id: 'FND-001',
          verdict: 'confirmed',
          title: 'SQL Injection',
          category: 'sql-injection',
          owaspCategory: 'A03:2021 - Injection',
          trace: {
            steps: [1, 2],
            commands: ['curl test'],
          },
          execution: {
            payload: '\' OR 1=1--',
            proofOutput: 'Flag: KX{test}',
          },
          intendedBehavior: 'Should validate input',
          confidence: {
            level: 'high',
            reason: 'Flag captured',
          },
          severity: {
            likelihood: 'high',
            impact: 'critical',
            overallSeverity: 'critical',
          },
          remediation: 'Use parameterized queries',
          verifiedBy: 'verifier-agent',
          verifiedAt: new Date().toISOString(),
        } as ConfirmedFinding,
      ],
    };
    
    const path = resolve(testDir, 'valid-findings.json');
    writeFileSync(path, JSON.stringify(validFindings, null, 2));
    
    const result = validateFindings(path);
    expect(result.valid).toBe(true);
  });
  
  it('should reject findings with invalid verdict', () => {
    const invalidFindings = {
      version: '1.0.0',
      runId: 'test-001',
      challenge: 'test',
      timestamp: new Date().toISOString(),
      harnessMode: 'single-model',
      findings: [
        {
          id: 'FND-001',
          verdict: 'invalid-verdict',
          title: 'Test',
          category: 'other',
        },
      ],
    };
    
    const path = resolve(testDir, 'invalid-findings.json');
    writeFileSync(path, JSON.stringify(invalidFindings, null, 2));
    
    const result = validateFindings(path);
    expect(result.valid).toBe(false);
    expect(result.output).toContain('verdict');
  });
  
  it('should reject findings with extra properties', () => {
    const invalidFindings = {
      version: '1.0.0',
      runId: 'test-001',
      challenge: 'test',
      timestamp: new Date().toISOString(),
      harnessMode: 'single-model',
      extraProperty: 'not allowed',
      findings: [],
    };
    
    const path = resolve(testDir, 'extra-prop-findings.json');
    writeFileSync(path, JSON.stringify(invalidFindings, null, 2));
    
    const result = validateFindings(path);
    expect(result.valid).toBe(false);
    expect(result.output).toContain('extraProperty');
  });
});

describe('Coverage Ledger Validator', () => {
  const testDir = resolve(process.cwd(), 'test-harness-tmp');
  
  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });
  
  afterEach(() => {
    try {
      const fs = require('fs');
      if (existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore
    }
  });
  
  it('should validate correct coverage-ledger.json', () => {
    const validLedger: CoverageLedger = {
      version: '1.0.0',
      runId: 'test-001',
      challenge: 'test',
      timestamp: new Date().toISOString(),
      units: [
        {
          id: 'COV-001',
          name: 'Reconnaissance',
          description: 'Recon coverage',
          surface: 'reconnaissance',
          state: 'completed',
          assignedTo: 'agent-1',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          findingIds: [],
          techniques: ['T1190'],
        },
      ],
      summary: {
        planned: 0,
        inProgress: 0,
        completed: 1,
        deferred: 0,
      },
    };
    
    const path = resolve(testDir, 'valid-ledger.json');
    writeFileSync(path, JSON.stringify(validLedger, null, 2));
    
    const result = validateCoverageLedger(path);
    expect(result.valid).toBe(true);
  });
  
  it('should reject ledger with mismatched summary', () => {
    const invalidLedger = {
      version: '1.0.0',
      runId: 'test-001',
      challenge: 'test',
      timestamp: new Date().toISOString(),
      units: [
        {
          id: 'COV-001',
          name: 'Test',
          description: 'Test',
          surface: 'test',
          state: 'completed',
          findingIds: [],
          techniques: [],
        },
      ],
      summary: {
        planned: 0,
        inProgress: 0,
        completed: 5,  // Wrong count
        deferred: 0,
      },
    };
    
    const path = resolve(testDir, 'invalid-ledger.json');
    writeFileSync(path, JSON.stringify(invalidLedger, null, 2));
    
    const result = validateCoverageLedger(path);
    expect(result.valid).toBe(false);
    expect(result.output).toContain('summary.completed');
  });
});
