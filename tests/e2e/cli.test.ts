import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const CLI_PATH = resolve(import.meta.dirname, '../../src/index.ts');

function runCliExpectFailure(args: string, env: Record<string, string> = {}): string {
  try {
    execSync(`npx tsx ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      timeout: 15000,
    }).toString();
  } catch (e: any) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
  }
  throw new Error(`Expected command to fail: ${args}`);
}

// =============================================================================
// Run ID Validation — path traversal prevention
// =============================================================================

describe('run-id validation', () => {
  it('rejects traversal in report command', () => {
    const output = runCliExpectFailure('report ../x');
    expect(output).toContain('Invalid run ID');
  });

  it('rejects traversal in results show command', () => {
    const output = runCliExpectFailure('results show ../../etc/passwd');
    expect(output).toContain('Invalid run ID');
  });

  it('rejects traversal in results compare command', () => {
    const output = runCliExpectFailure('results compare ../x run-123');
    expect(output).toContain('Invalid run ID');
  });

  it('rejects traversal in analyze command', () => {
    const tempResultsDir = mkdtempSync(join(tmpdir(), 'oasis-results-'));
    try {
      const output = runCliExpectFailure('analyze ../x -p ollama', {
        OASIS_RESULTS_DIR: tempResultsDir,
      });
      expect(output).toContain('Invalid run ID');
    } finally {
      rmSync(tempResultsDir, { recursive: true, force: true });
    }
  });
});
