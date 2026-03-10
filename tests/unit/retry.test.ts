import { describe, it, expect, vi } from 'vitest';
import {
  isRetryableStatus,
  getRetryDelayMs,
  withRateLimitRetry,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_BASE_DELAY_MS,
  QuotaExceededError,
  isQuotaExceededError,
  ApiTimeoutError,
} from '../../src/lib/retry.js';

// =============================================================================
// isRetryableStatus
// =============================================================================

describe('isRetryableStatus', () => {
  it('returns true for retryable statuses (429, 500, 502, 503)', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('returns false for non-retryable statuses', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

// =============================================================================
// getRetryDelayMs
// =============================================================================

describe('getRetryDelayMs', () => {
  it('uses Retry-After header when available, capped at 60s', () => {
    expect(getRetryDelayMs(0, { headers: { 'retry-after': '5' } })).toBe(5000);
    expect(getRetryDelayMs(0, { headers: { 'retry-after': '120' } })).toBe(60000);
  });

  it('checks response.headers for Retry-After', () => {
    expect(getRetryDelayMs(0, { response: { headers: { 'Retry-After': '3' } } })).toBe(3000);
  });
});

// =============================================================================
// withRateLimitRetry
// =============================================================================

describe('withRateLimitRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRateLimitRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 429, headers: { 'retry-after': '0' } })
      .mockResolvedValue('ok');

    vi.useFakeTimers();
    const promise = withRateLimitRetry(fn, 'test');
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401 });
    await expect(withRateLimitRetry(fn, 'test')).rejects.toEqual({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after max retries exhausted', async () => {
    const error429 = { status: 429 };
    const fn = vi.fn().mockRejectedValue(error429);

    vi.useFakeTimers();
    const result = withRateLimitRetry(fn, 'test').catch((e) => ({ caught: e }));
    await vi.runAllTimersAsync();
    const outcome = await result;
    vi.useRealTimers();

    expect((outcome as any).caught).toEqual(error429);
    expect(fn).toHaveBeenCalledTimes(RATE_LIMIT_MAX_RETRIES + 1);
  });

  it('throws QuotaExceededError immediately on quota 429 (no retries)', async () => {
    const quotaError = { status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' };
    const fn = vi.fn().mockRejectedValue(quotaError);

    await expect(withRateLimitRetry(fn, 'test')).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still retries transient rate-limit 429s', async () => {
    const rateLimitError = { status: 429, code: 'rate_limit_exceeded' };
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValue('ok');

    vi.useFakeTimers();
    const promise = withRateLimitRetry(fn, 'test');
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// isQuotaExceededError
// =============================================================================

describe('isQuotaExceededError', () => {
  it('returns true for quota exceeded indicators', () => {
    expect(isQuotaExceededError({ code: 'insufficient_quota' })).toBe(true);
    expect(isQuotaExceededError({ error: { code: 'insufficient_quota' } })).toBe(true);
    expect(isQuotaExceededError({ message: 'You exceeded your current quota, please check your plan.' })).toBe(true);
  });

  it('returns false for non-quota errors', () => {
    expect(isQuotaExceededError({ code: 'rate_limit_exceeded' })).toBe(false);
    expect(isQuotaExceededError({ status: 429 })).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
  });
});

// =============================================================================
// Error constructors
// =============================================================================

describe('QuotaExceededError', () => {
  it('stores provider and model metadata', () => {
    const err = new QuotaExceededError('test', 'openai', 'gpt-4o');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QuotaExceededError');
    expect(err.provider).toBe('openai');
    expect(err.model).toBe('gpt-4o');
  });
});

describe('ApiTimeoutError', () => {
  it('includes context and timeout in message', () => {
    const err = new ApiTimeoutError('Analysis', 120000);
    expect(err.message).toBe('Analysis: timed out after 120s');
  });
});

// =============================================================================
// withRateLimitRetry — timeout behavior
// =============================================================================

describe('withRateLimitRetry timeout', () => {
  it('throws ApiTimeoutError when operation exceeds timeout', async () => {
    const slowFn = () => new Promise<string>(resolve => setTimeout(() => resolve('done'), 5000));
    await expect(withRateLimitRetry(slowFn, 'TestOp', false, 50)).rejects.toThrow(ApiTimeoutError);
  });

  it('succeeds when operation completes within timeout', async () => {
    const fastFn = () => Promise.resolve('quick');
    const result = await withRateLimitRetry(fastFn, 'TestOp', false, 5000);
    expect(result).toBe('quick');
  });
});
