import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { tmpdir } from 'os';
import {
  InvalidRunIdError,
  resolveAnalysisPath,
  resolveResultPath,
  isValidRunId,
} from '../../src/lib/results-path.js';

describe('results path helpers', () => {
  const previousResultsDir = process.env.OASIS_RESULTS_DIR;
  let testResultsDir: string;

  beforeEach(() => {
    testResultsDir = mkdtempSync(join(tmpdir(), 'oasis-results-'));
    process.env.OASIS_RESULTS_DIR = testResultsDir;
  });

  afterEach(() => {
    rmSync(testResultsDir, { recursive: true, force: true });
    if (previousResultsDir === undefined) {
      delete process.env.OASIS_RESULTS_DIR;
      return;
    }
    process.env.OASIS_RESULTS_DIR = previousResultsDir;
  });

  it('resolves result and analysis paths for valid run IDs', () => {
    const runId = 'run_123-abc';

    expect(resolveResultPath(runId)).toBe(pathResolve(testResultsDir, `${runId}.json`));
    expect(resolveAnalysisPath(runId)).toBe(pathResolve(testResultsDir, `${runId}.analysis.json`));
  });

  it('rejects traversal payload "../x"', () => {
    expect(() => resolveResultPath('../x')).toThrow(InvalidRunIdError);
  });

  it('rejects traversal payload "../../etc/passwd"', () => {
    expect(() => resolveResultPath('../../etc/passwd')).toThrow(InvalidRunIdError);
  });

  it('rejects absolute path payload', () => {
    expect(() => resolveResultPath('/tmp/oasis-poc')).toThrow(InvalidRunIdError);
  });

  it('validates run ID format with strict allowlist', () => {
    expect(isValidRunId('abc_DEF-123')).toBe(true);
    expect(isValidRunId('run.id')).toBe(false);
    expect(isValidRunId('..')).toBe(false);
  });
});
