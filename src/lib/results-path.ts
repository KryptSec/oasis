import { isAbsolute, relative as pathRelative, resolve as pathResolve } from 'path';
import { getResultsDir } from './config.js';

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class InvalidRunIdError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Invalid run ID: ${runId}`);
    this.name = 'InvalidRunIdError';
    this.runId = runId;
  }
}

export class ResultPathEscapeError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Run ID resolves outside results directory: ${runId}`);
    this.name = 'ResultPathEscapeError';
    this.runId = runId;
  }
}

export function isValidRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId);
}

export function resolveResultPath(runId: string): string {
  return resolveResultArtifactPath(runId, '.json');
}

export function resolveAnalysisPath(runId: string): string {
  return resolveResultArtifactPath(runId, '.analysis.json');
}

function resolveResultArtifactPath(runId: string, suffix: '.json' | '.analysis.json'): string {
  if (!isValidRunId(runId)) {
    throw new InvalidRunIdError(runId);
  }

  const resultsDir = getResultsDir();
  const resolvedPath = pathResolve(resultsDir, `${runId}${suffix}`);

  if (!isPathInsideDir(resultsDir, resolvedPath)) {
    throw new ResultPathEscapeError(runId);
  }

  return resolvedPath;
}

function isPathInsideDir(baseDir: string, targetPath: string): boolean {
  const relativePath = pathRelative(baseDir, targetPath);
  return !relativePath.startsWith('..') && !isAbsolute(relativePath);
}
