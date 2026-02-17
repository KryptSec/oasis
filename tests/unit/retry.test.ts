import { describe, it, expect, vi } from 'vitest';
import {
  getErrorStatus,
  getRetryAfterHeader,
  isRetryableStatus,
  getRetryDelayMs,
  withRateLimitRetry,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_BASE_DELAY_MS,
} from '../../src/lib/retry.js';

// =============================================================================
// getErrorStatus
// =============================================================================

describe('getErrorStatus', () => {
  it('extracts status from error.status', () => {
    expect(getErrorStatus({ status: 429 })).toBe(429);
  });

  it('extracts status from error.statusCode', () => {
    expect(getErrorStatus({ statusCode: 500 })).toBe(500);
  });

  it('extracts status from error.response.status', () => {
    expect(getErrorStatus({ response: { status: 503 } })).toBe(503);
  });

  it('prefers error.status over nested', () => {
    expect(getErrorStatus({ status: 429, response: { status: 500 } })).toBe(429);
  });

  it('returns undefined for plain errors', () => {
    expect(getErrorStatus(new Error('network error'))).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(getErrorStatus(null)).toBeUndefined();
    expect(getErrorStatus(undefined)).toBeUndefined();
  });
});

// =============================================================================
// isRetryableStatus
// =============================================================================

describe('isRetryableStatus', () => {
  it('returns true for 429', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it('returns true for 500', () => {
    expect(isRetryableStatus(500)).toBe(true);
  });

  it('returns true for 502', () => {
    expect(isRetryableStatus(502)).toBe(true);
  });

  it('returns true for 503', () => {
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('returns false for 400', () => {
    expect(isRetryableStatus(400)).toBe(false);
  });

  it('returns false for 401', () => {
    expect(isRetryableStatus(401)).toBe(false);
  });

  it('returns false for 404', () => {
    expect(isRetryableStatus(404)).toBe(false);
  });

  it('returns false for 200', () => {
    expect(isRetryableStatus(200)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

// =============================================================================
// getRetryDelayMs
// =============================================================================

describe('getRetryDelayMs', () => {
  it('returns exponential backoff for attempt 0', () => {
    expect(getRetryDelayMs(0, {})).toBe(RATE_LIMIT_BASE_DELAY_MS); // 2000
  });

  it('returns exponential backoff for attempt 1', () => {
    expect(getRetryDelayMs(1, {})).toBe(RATE_LIMIT_BASE_DELAY_MS * 2); // 4000
  });

  it('returns exponential backoff for attempt 2', () => {
    expect(getRetryDelayMs(2, {})).toBe(RATE_LIMIT_BASE_DELAY_MS * 4); // 8000
  });

  it('uses Retry-After header when available (seconds)', () => {
    const error = { headers: { 'retry-after': '5' } };
    expect(getRetryDelayMs(0, error)).toBe(5000);
  });

  it('uses Retry-After from Headers object (get method)', () => {
    const headers = new Headers();
    headers.set('retry-after', '10');
    const error = { headers };
    expect(getRetryDelayMs(0, error)).toBe(10000);
  });

  it('caps Retry-After at 60 seconds', () => {
    const error = { headers: { 'retry-after': '120' } };
    expect(getRetryDelayMs(0, error)).toBe(60000);
  });

  it('falls back to exponential backoff for invalid Retry-After', () => {
    const error = { headers: { 'retry-after': 'invalid' } };
    expect(getRetryDelayMs(0, error)).toBe(RATE_LIMIT_BASE_DELAY_MS);
  });

  it('checks response.headers for Retry-After', () => {
    const error = { response: { headers: { 'Retry-After': '3' } } };
    expect(getRetryDelayMs(0, error)).toBe(3000);
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

    // Speed up the test by mocking setTimeout
    vi.useFakeTimers();
    const promise = withRateLimitRetry(fn, 'test');
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValue('ok');

    vi.useFakeTimers();
    const promise = withRateLimitRetry(fn, 'test');
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable errors (401)', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401 });
    await expect(withRateLimitRetry(fn, 'test')).rejects.toEqual({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on non-retryable errors (400)', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    await expect(withRateLimitRetry(fn, 'test')).rejects.toEqual({ status: 400 });
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
});
