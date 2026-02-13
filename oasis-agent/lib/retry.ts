/**
 * Rate limit retry utilities: 429/5xx handling with exponential backoff and Retry-After support.
 */

import chalk from 'chalk';

export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 2000;

export function getErrorStatus(error: unknown): number | undefined {
  const err = error as { status?: number; statusCode?: number; response?: { status?: number } };
  return err?.status ?? err?.statusCode ?? err?.response?.status;
}

export function getRetryAfterHeader(error: unknown): string | undefined {
  const err = error as {
    headers?: Headers | Record<string, string>;
    response?: { headers?: Headers | Record<string, string> };
  };
  const headers = err?.headers ?? err?.response?.headers;
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get?.('retry-after') ?? undefined;
  }
  return (headers as Record<string, string>)?.['retry-after'] ?? (headers as Record<string, string>)?.['Retry-After'];
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status != null && status >= 500 && status < 600);
}

export function getRetryDelayMs(attempt: number, error: unknown): number {
  const retryAfter = getRetryAfterHeader(error);
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 60000); // Cap at 60s per spec
    }
  }
  return RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt);
}

export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      const isRetryable = isRetryableStatus(status);
      const hasAttemptsLeft = attempt < RATE_LIMIT_MAX_RETRIES;

      if (!isRetryable || !hasAttemptsLeft) {
        throw error;
      }

      const delayMs = getRetryDelayMs(attempt, error);
      console.log(chalk.yellow(
        `[Rate limit] ${context}: ${status} on attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES + 1}. ` +
        `Retrying in ${delayMs / 1000}s...`
      ));
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
