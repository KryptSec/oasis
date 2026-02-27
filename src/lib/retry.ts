// Rate-limit retry utilities: 429/5xx handling with exponential backoff and Retry-After support.

import chalk from 'chalk';
import { OasisError } from './errors.js';

export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 2000;

export class QuotaExceededError extends OasisError {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly model?: string,
  ) {
    super(message, { provider, model });
    this.name = 'QuotaExceededError';
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  if (err.code === 'insufficient_quota') return true;
  if (err.error != null && typeof err.error === 'object' &&
      (err.error as Record<string, unknown>).code === 'insufficient_quota') return true;
  if (typeof err.message === 'string' &&
      err.message.toLowerCase().includes('exceeded your current quota')) return true;
  return false;
}

export function getErrorStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;
  if (typeof err.status === 'number') return err.status;
  if (typeof err.statusCode === 'number') return err.statusCode;
  if (err.response != null && typeof err.response === 'object') {
    const resp = err.response as Record<string, unknown>;
    if (typeof resp.status === 'number') return resp.status;
  }
  return undefined;
}

export function getRetryAfterHeader(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;
  const headersSource = err.headers ??
    (err.response != null && typeof err.response === 'object'
      ? (err.response as Record<string, unknown>).headers
      : undefined);
  if (headersSource == null || typeof headersSource !== 'object') return undefined;
  if (typeof (headersSource as { get?: unknown }).get === 'function') {
    return ((headersSource as Headers).get('retry-after')) ?? undefined;
  }
  const hdr = headersSource as Record<string, string>;
  return hdr['retry-after'] ?? hdr['Retry-After'];
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status != null && status >= 500 && status < 600);
}

export function getRetryDelayMs(attempt: number, error: unknown): number {
  const retryAfter = getRetryAfterHeader(error);
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 60000); // Cap at 60s
    }
  }
  return RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt);
}

export const DEFAULT_API_TIMEOUT_MS = 120_000; // 2 minutes

export class ApiTimeoutError extends OasisError {
  constructor(context: string, timeoutMs: number) {
    super(`${context}: timed out after ${timeoutMs / 1000}s`, { context, timeoutMs });
    this.name = 'ApiTimeoutError';
  }
}

export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  context: string,
  verbose = false,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new ApiTimeoutError(context, timeoutMs)), timeoutMs)
        ),
      ]);
      return result;
    } catch (error) {
      if (error instanceof ApiTimeoutError) throw error;
      lastError = error;
      const status = getErrorStatus(error);

      if (status === 429 && isQuotaExceededError(error)) {
        throw new QuotaExceededError(
          `API quota reached — retrying won't help`,
        );
      }

      const isRetryable = isRetryableStatus(status);
      const hasAttemptsLeft = attempt < RATE_LIMIT_MAX_RETRIES;

      if (!isRetryable || !hasAttemptsLeft) {
        throw error;
      }

      const delayMs = getRetryDelayMs(attempt, error);
      if (verbose) {
        console.log(chalk.yellow(
          `[Rate limit] ${context}: ${status} on attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES + 1}. ` +
          `Retrying in ${delayMs / 1000}s...`
        ));
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
