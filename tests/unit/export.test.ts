import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunResult, AnalysisResult } from '../../src/lib/types.js';

// Mock @inquirer/prompts before importing the module under test
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
}));

const { promptExport } = await import('../../src/lib/export.js');

function makeRunResult(): RunResult {
  return {
    id: 'test-run-001',
    model: 'anthropic',
    modelVersion: 'claude-3',
    challenge: 'gatekeeper',
    startTime: new Date(),
    endTime: new Date(),
    success: false,
    flag: null,
    totalTime: 10,
    iterations: 1,
    tokens: { input: 0, output: 0, total: 0 },
    steps: [],
    techniquesUsed: [],
    tacticBreakdown: {},
    methodologies: [],
    toolsUsed: [],
    methodologyBreakdown: {},
  };
}

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    runId: 'test-run-001',
    analyzedAt: new Date(),
    analyzerModel: 'claude-3',
    attackChain: { phases: [], techniques: [], killChainCoverage: [] },
    narrative: { summary: 'Test', detailed: 'Test', keyFindings: [] },
    behavior: { approach: 'methodical', approachDescription: '', strengths: [], inefficiencies: [], decisionQuality: 50 },
    strategy: { reconQuality: 50, exploitEfficiency: 50, adaptability: 50, overallScore: 50, scoreBreakdown: '' },
    ...overrides,
  };
}

describe('promptExport', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('skips export when analysis is undefined', async () => {
    await promptExport(makeRunResult(), undefined);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No analysis available');
    expect(output).toContain('oasis analyze test-run-001');
  });

  it('skips export when analysis.parseFailed is true', async () => {
    const analysis = makeAnalysis({ parseFailed: true });
    await promptExport(makeRunResult(), analysis);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No analysis available');
    expect(output).toContain('oasis analyze test-run-001');
  });

  it('does not skip export for valid analysis (parseFailed undefined)', async () => {
    const { select } = await import('@inquirer/prompts');
    (select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('done');

    const analysis = makeAnalysis();
    await promptExport(makeRunResult(), analysis);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('No analysis available');
    expect(output).toContain('oasis report test-run-001');
  });

  it('does not skip export for explicit parseFailed: false', async () => {
    const { select } = await import('@inquirer/prompts');
    (select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('done');

    const analysis = makeAnalysis({ parseFailed: false });
    await promptExport(makeRunResult(), analysis);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('No analysis available');
    expect(output).toContain('oasis report test-run-001');
  });
});
