import { describe, it, expect } from 'vitest';
import {
  generateTextReport,
  generateJsonReport,
  generateMarkdownReport,
} from '../../src/lib/report.js';
import type { RunResult, AnalysisResult } from '../../src/lib/types.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

function loadFixture<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, path), 'utf-8'));
}

const successfulRun = loadFixture<RunResult>('results/successful-run.json');
const failedRun = loadFixture<RunResult>('results/failed-run.json');
const analysisResult = loadFixture<AnalysisResult>('results/analysis-result.json');

// =============================================================================
// generateTextReport
// =============================================================================

describe('generateTextReport', () => {
  it('generates box-drawing formatted report', () => {
    const report = generateTextReport(successfulRun);
    expect(report).toContain('OASIS AFTER-ACTION REPORT');
    expect(report).toContain('╔');
    expect(report).toContain('╗');
    expect(report).toContain('╚');
    expect(report).toContain('╝');
  });

  it('includes run metadata', () => {
    const report = generateTextReport(successfulRun);
    expect(report).toContain(successfulRun.id);
    expect(report).toContain(successfulRun.modelVersion);
    expect(report).toContain(successfulRun.challenge);
  });

  it('shows SUCCESS for successful runs', () => {
    const report = generateTextReport(successfulRun);
    expect(report).toContain('SUCCESS');
    expect(report).toContain(successfulRun.flag!);
  });

  it('shows FAILED for failed runs', () => {
    const report = generateTextReport(failedRun);
    expect(report).toContain('FAILED');
    expect(report).toContain('NOT FOUND');
  });

  it('includes ATT&CK techniques section', () => {
    const report = generateTextReport(successfulRun);
    expect(report).toContain('ATT&CK TECHNIQUES USED');
    expect(report).toContain('T1592');
    expect(report).toContain('T1190');
  });

  it('includes attack path with iteration numbers', () => {
    const report = generateTextReport(successfulRun);
    expect(report).toContain('ATTACK PATH');
  });

  it('includes tools used section', () => {
    const report = generateTextReport(successfulRun);
    expect(report).toContain('TOOLS USED');
    expect(report).toContain('curl');
  });
});

// =============================================================================
// generateJsonReport
// =============================================================================

describe('generateJsonReport', () => {
  it('generates valid JSON', () => {
    const json = generateJsonReport(successfulRun);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes metadata section', () => {
    const report = JSON.parse(generateJsonReport(successfulRun));
    expect(report.metadata.runId).toBe(successfulRun.id);
    expect(report.metadata.model).toBe(successfulRun.modelVersion);
    expect(report.metadata.challenge).toBe(successfulRun.challenge);
  });

  it('includes result section', () => {
    const report = JSON.parse(generateJsonReport(successfulRun));
    expect(report.result.success).toBe(true);
    expect(report.result.flag).toBe(successfulRun.flag);
    expect(report.result.tokens).toBeDefined();
  });

  it('includes techniques and steps', () => {
    const report = JSON.parse(generateJsonReport(successfulRun));
    expect(report.techniques).toHaveLength(2);
    expect(report.steps.length).toBeGreaterThan(0);
  });

  it('includes analysis when provided', () => {
    const report = JSON.parse(generateJsonReport(successfulRun, analysisResult));
    expect(report.analysis).toBeDefined();
    expect(report.analysis.overallScore).toBe(82);
    expect(report.analysis.approach).toBe('targeted');
  });

  it('excludes analysis when not provided', () => {
    const report = JSON.parse(generateJsonReport(successfulRun));
    expect(report.analysis).toBeUndefined();
  });
});

// =============================================================================
// generateMarkdownReport
// =============================================================================

describe('generateMarkdownReport', () => {
  it('starts with H1 header', () => {
    const md = generateMarkdownReport(successfulRun);
    expect(md).toMatch(/^# OASIS Benchmark Report/);
  });

  it('includes run summary table', () => {
    const md = generateMarkdownReport(successfulRun);
    expect(md).toContain('| Run ID |');
    expect(md).toContain(successfulRun.id);
  });

  it('includes MITRE ATT&CK techniques table', () => {
    const md = generateMarkdownReport(successfulRun);
    expect(md).toContain('## MITRE ATT&CK Techniques');
    expect(md).toContain('T1190');
    expect(md).toContain('attack.mitre.org');
  });

  it('includes attack path table', () => {
    const md = generateMarkdownReport(successfulRun);
    expect(md).toContain('## Attack Path');
    expect(md).toContain('| Step |');
  });

  it('includes analysis section when provided', () => {
    const md = generateMarkdownReport(successfulRun, analysisResult);
    expect(md).toContain('## Analysis');
    expect(md).toContain('Overall Score');
    expect(md).toContain('Executive Summary');
    expect(md).toContain('Key Findings');
  });

  it('includes rubric score when in analysis', () => {
    const md = generateMarkdownReport(successfulRun, analysisResult);
    expect(md).toContain('Rubric Score');
    expect(md).toContain('Objective');
    expect(md).toContain('Milestones');
  });

  it('ends with generated-by footer', () => {
    const md = generateMarkdownReport(successfulRun);
    expect(md).toContain('Generated by [OASIS]');
  });
});
