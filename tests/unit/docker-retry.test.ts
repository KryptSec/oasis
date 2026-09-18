import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import {
  pullImage,
  classifyPullError,
  DOCKER_PULL_MAX_ATTEMPTS,
} from '../../src/lib/docker.js';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

/** Build an error shaped like a failed execFileSync (stderr carries docker's message). */
function dockerError(stderr: string): Error & { stderr: string } {
  const err = new Error(stderr) as Error & { stderr: string };
  err.stderr = stderr;
  return err;
}

function getPullCalls(): string[][] {
  return mockExecFileSync.mock.calls
    .filter(c => c[0] === 'docker' && (c[1] as string[])[0] === 'pull')
    .map(c => c[1] as string[]);
}

/** No-op sleep so retry tests do not actually wait. */
const noSleep = () => {};

// =============================================================================
// classifyPullError
// =============================================================================

describe('classifyPullError', () => {
  it('classifies missing platform manifests', () => {
    expect(classifyPullError(dockerError('no matching manifest for linux/arm64/v8'))).toBe('manifest');
    expect(classifyPullError(dockerError('no match for platform in manifest'))).toBe('manifest');
  });

  it('classifies 5xx and rate-limit responses as transient', () => {
    expect(classifyPullError(dockerError('Error response from daemon: 503 Service Unavailable'))).toBe('transient');
    expect(classifyPullError(dockerError('received unexpected HTTP status: 502 Bad Gateway'))).toBe('transient');
    expect(classifyPullError(dockerError('504 Gateway Time-out'))).toBe('transient');
    expect(classifyPullError(dockerError('toomanyrequests: You have reached your pull rate limit'))).toBe('transient');
  });

  it('classifies network failures as transient', () => {
    expect(classifyPullError(dockerError('dial tcp: connection refused'))).toBe('transient');
    expect(classifyPullError(dockerError('net/http: TLS handshake timeout'))).toBe('transient');
    expect(classifyPullError(dockerError('Get https://registry-1.docker.io: i/o timeout'))).toBe('transient');
    expect(classifyPullError(dockerError('unexpected EOF'))).toBe('transient');
  });

  it('classifies fatal errors that retrying cannot fix', () => {
    expect(classifyPullError(dockerError('pull access denied for foo, repository does not exist'))).toBe('fatal');
    expect(classifyPullError(dockerError('unauthorized: authentication required'))).toBe('fatal');
    expect(classifyPullError(dockerError('manifest unknown'))).toBe('fatal');
  });

  it('treats an unrecognized error as fatal (fail fast)', () => {
    expect(classifyPullError(dockerError('something entirely unexpected'))).toBe('fatal');
  });

  it('handles non-object and message-only errors without throwing', () => {
    expect(classifyPullError(null)).toBe('fatal');
    expect(classifyPullError('503 Service Unavailable')).toBe('fatal'); // string, not err object → no signal read
    expect(classifyPullError(new Error('503 Service Unavailable'))).toBe('transient');
  });
});

// =============================================================================
// pullImage — transient retry
// =============================================================================

describe('pullImage transient retry', () => {
  it('retries a 503 and succeeds without falling back to amd64', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('503 Service Unavailable'); })
      .mockImplementationOnce(() => { throw dockerError('503 Service Unavailable'); })
      .mockReturnValue('' as any);

    const usedFallback = pullImage('myimage:latest', undefined, { sleep: noSleep });

    expect(usedFallback).toBe(false);
    const pulls = getPullCalls();
    expect(pulls).toHaveLength(3);
    // All three attempts are native pulls — no --platform
    for (const args of pulls) {
      expect(args).not.toContain('--platform');
    }
  });

  it('uses exponential backoff between retries', () => {
    const sleeps: number[] = [];
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('503 Service Unavailable'); })
      .mockImplementationOnce(() => { throw dockerError('503 Service Unavailable'); })
      .mockReturnValue('' as any);

    pullImage('myimage:latest', undefined, {
      baseDelayMs: 1000,
      sleep: (ms) => { sleeps.push(ms); },
    });

    expect(sleeps).toEqual([1000, 2000]); // 1s, then 2s
  });

  it('gives up after DOCKER_PULL_MAX_ATTEMPTS and rethrows the transient error', () => {
    mockExecFileSync.mockImplementation(() => { throw dockerError('503 Service Unavailable'); });

    expect(() => pullImage('myimage:latest', undefined, { sleep: noSleep })).toThrow(/503/);
    expect(getPullCalls()).toHaveLength(DOCKER_PULL_MAX_ATTEMPTS);
  });

  it('does NOT retry fatal errors — fails on the first attempt', () => {
    mockExecFileSync.mockImplementation(() => {
      throw dockerError('pull access denied, repository does not exist');
    });

    expect(() => pullImage('myimage:latest', undefined, { sleep: noSleep }))
      .toThrow(/access denied/);
    expect(getPullCalls()).toHaveLength(1);
  });

  it('invokes onRetry with attempt, max, delay and reason', () => {
    const events: Array<[number, number, number, string]> = [];
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('503 Service Unavailable'); })
      .mockReturnValue('' as any);

    pullImage('myimage:latest', undefined, {
      baseDelayMs: 500,
      sleep: noSleep,
      onRetry: (attempt, max, delay, reason) => { events.push([attempt, max, delay, reason]); },
    });

    expect(events).toHaveLength(1);
    const [attempt, max, delay, reason] = events[0];
    expect(attempt).toBe(1);
    expect(max).toBe(DOCKER_PULL_MAX_ATTEMPTS);
    expect(delay).toBe(500);
    expect(reason).toMatch(/503/);
  });

  it('honours a custom maxAttempts', () => {
    mockExecFileSync.mockImplementation(() => { throw dockerError('503 Service Unavailable'); });

    expect(() => pullImage('myimage:latest', undefined, { maxAttempts: 5, sleep: noSleep })).toThrow();
    expect(getPullCalls()).toHaveLength(5);
  });

  it('a transient failure never triggers the amd64 fallback', () => {
    mockExecFileSync.mockImplementation(() => { throw dockerError('toomanyrequests'); });

    expect(() => pullImage('myimage:latest', undefined, { sleep: noSleep })).toThrow();
    const pulls = getPullCalls();
    // Every attempt is a native pull; we never tried --platform as a workaround
    expect(pulls.every(a => !a.includes('--platform'))).toBe(true);
  });
});

// =============================================================================
// pullImage — manifest fallback still works
// =============================================================================

describe('pullImage manifest fallback', () => {
  it('falls back to linux/amd64 on a manifest error and returns true', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('no matching manifest for linux/arm64/v8'); })
      .mockReturnValue('' as any);

    const usedFallback = pullImage('myimage:latest', undefined, { sleep: noSleep });

    expect(usedFallback).toBe(true);
    const pulls = getPullCalls();
    expect(pulls).toHaveLength(2);
    expect(pulls[1]).toContain('--platform');
    expect(pulls[1]).toContain('linux/amd64');
  });

  it('does not retry the native pull on a manifest error (deterministic)', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('no match for platform'); })
      .mockReturnValue('' as any);

    pullImage('myimage:latest', undefined, { sleep: noSleep });

    const nativePulls = getPullCalls().filter(a => !a.includes('--platform'));
    expect(nativePulls).toHaveLength(1);
  });

  it('retries a transient failure during the amd64 fallback', () => {
    mockExecFileSync
      // native: manifest error → go to fallback
      .mockImplementationOnce(() => { throw dockerError('no matching manifest'); })
      // fallback attempt 1: flaky
      .mockImplementationOnce(() => { throw dockerError('503 Service Unavailable'); })
      // fallback attempt 2: success
      .mockReturnValue('' as any);

    const usedFallback = pullImage('myimage:latest', undefined, { baseDelayMs: 1, sleep: noSleep });

    expect(usedFallback).toBe(true);
    const pulls = getPullCalls();
    expect(pulls).toHaveLength(3);
    expect(pulls[2]).toContain('--platform');
  });

  it('throws if the amd64 fallback keeps failing transiently', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('no matching manifest'); })
      .mockImplementation(() => { throw dockerError('502 Bad Gateway'); });

    expect(() => pullImage('myimage:latest', undefined, { sleep: noSleep })).toThrow(/502/);
  });
});

// =============================================================================
// pullImage — preserved original contract
// =============================================================================

describe('pullImage preserved behaviour', () => {
  it('returns false when the native pull succeeds on the first try', () => {
    mockExecFileSync.mockReturnValue('' as any);
    expect(pullImage('myimage:latest')).toBe(false);
    expect(getPullCalls()).toHaveLength(1);
  });

  it('reports progress for the initial pull and the fallback', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('no matching manifest'); })
      .mockReturnValue('' as any);

    const messages: string[] = [];
    pullImage('myimage:latest', (m) => messages.push(m), { sleep: noSleep });

    expect(messages).toContain('Pulling myimage:latest...');
    expect(messages).toContain('Pulling myimage:latest (linux/amd64 fallback)...');
  });

  it('reports retry progress to onProgress', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw dockerError('503 Service Unavailable'); })
      .mockReturnValue('' as any);

    const messages: string[] = [];
    pullImage('myimage:latest', (m) => messages.push(m), { baseDelayMs: 1000, sleep: noSleep });

    expect(messages.some(m => m.includes('retrying in 1s'))).toBe(true);
  });

  it('passes image name as a discrete argument (no shell interpolation)', () => {
    mockExecFileSync.mockReturnValue('' as any);
    pullImage("evil'image");
    expect(getPullCalls()[0]).toContain("evil'image");
  });

  it('works with no options argument at all (backwards compatible)', () => {
    mockExecFileSync.mockReturnValue('' as any);
    expect(() => pullImage('myimage:latest')).not.toThrow();
  });
});
