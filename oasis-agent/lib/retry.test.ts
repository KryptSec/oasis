import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getErrorStatus,
  getRetryAfterHeader,
  isRetryableStatus,
  getRetryDelayMs,
  withRateLimitRetry,
  RATE_LIMIT_MAX_RETRIES,
} from './retry.js';

describe('getErrorStatus', () => {
  it('extracts status from error.status', () => {
    expect(getErrorStatus({ status: 429 })).toBe(429);
    expect(getErrorStatus({ status: 400 })).toBe(400);
  });

  it('extracts status from error.statusCode', () => {
    expect(getErrorStatus({ statusCode: 503 })).toBe(503);
  });

  it('extracts status from error.response.status', () => {
    expect(getErrorStatus({ response: { status: 500 } })).toBe(500);
  });

  it('returns undefined for unknown error shape', () => {
    expect(getErrorStatus(new Error('foo'))).toBeUndefined();
    expect(getErrorStatus({})).toBeUndefined();
  });
});

describe('getRetryAfterHeader', () => {
  it('extracts retry-after from Headers-like object with get()', () => {
    const headers = { get: (name: string) => (name === 'retry-after' ? '5' : null) };
    expect(getRetryAfterHeader({ headers })).toBe('5');
  });

  it('extracts retry-after from Record', () => {
    expect(getRetryAfterHeader({ headers: { 'retry-after': '10' } })).toBe('10');
    expect(getRetryAfterHeader({ headers: { 'Retry-After': '15' } })).toBe('15');
  });

  it('extracts from response.headers', () => {
    expect(getRetryAfterHeader({ response: { headers: { 'retry-after': '3' } } })).toBe('3');
  });

  it('returns undefined when no header', () => {
    expect(getRetryAfterHeader({})).toBeUndefined();
    expect(getRetryAfterHeader({ headers: {} })).toBeUndefined();
  });
});

describe('isRetryableStatus', () => {
  it('returns true for 429', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it('returns true for 5xx', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it('returns false for 4xx (except 429)', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

describe('getRetryDelayMs', () => {
  it('uses Retry-After header when present and valid', () => {
    expect(getRetryDelayMs(0, { headers: { 'retry-after': '5' } })).toBe(5000);
    expect(getRetryDelayMs(1, { headers: { 'retry-after': '3' } })).toBe(3000);
  });

  it('caps Retry-After at 60s', () => {
    expect(getRetryDelayMs(0, { headers: { 'retry-after': '90' } })).toBe(60000);
  });

  it('falls back to exponential backoff when no header', () => {
    expect(getRetryDelayMs(0, {})).toBe(2000);
    expect(getRetryDelayMs(1, {})).toBe(4000);
    expect(getRetryDelayMs(2, {})).toBe(8000);
  });

  it('ignores invalid Retry-After', () => {
    expect(getRetryDelayMs(0, { headers: { 'retry-after': 'invalid' } })).toBe(2000);
  });
});

describe('withRateLimitRetry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRateLimitRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and eventually succeeds', async () => {
    const err429 = new Error('Rate limit') as Error & { status: number };
    err429.status = 429;
    const fn = vi.fn()
      .mockRejectedValueOnce(err429)
      .mockRejectedValueOnce(err429)
      .mockResolvedValue('ok');
    const resultPromise = withRateLimitRetry(fn, 'test');
    await vi.advanceTimersByTimeAsync(2000); // First retry delay
    await vi.advanceTimersByTimeAsync(4000); // Second retry delay
    const result = await resultPromise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 up to max then throws', async () => {
    const err429 = new Error('Rate limit') as Error & { status: number };
    err429.status = 429;
    const fn = vi.fn().mockRejectedValue(err429);
    const resultPromise = withRateLimitRetry(fn, 'test');
    // Advance timers and await rejection in same tick to avoid unhandled rejection
    const [thrown] = await Promise.all([
      resultPromise.then(() => null, (e: unknown) => e),
      vi.advanceTimersByTimeAsync(14000),
    ]);
    expect(thrown).toMatchObject({ message: 'Rate limit', status: 429 });
    expect(fn).toHaveBeenCalledTimes(RATE_LIMIT_MAX_RETRIES + 1);
  });

  it('does not retry on 400', async () => {
    const err400 = new Error('Bad request') as Error & { status: number };
    err400.status = 400;
    const fn = vi.fn().mockRejectedValue(err400);
    await expect(withRateLimitRetry(fn, 'test')).rejects.toThrow('Bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 503', async () => {
    const err503 = new Error('Service unavailable') as Error & { status: number };
    err503.status = 503;
    const fn = vi.fn()
      .mockRejectedValueOnce(err503)
      .mockResolvedValue('ok');
    const resultPromise = withRateLimitRetry(fn, 'test');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
