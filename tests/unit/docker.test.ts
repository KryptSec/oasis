import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import {
  pullImage,
  ensureNetwork,
  startContainers,
  pullAndStartContainers,
  cleanup,
  cleanupStale,
} from '../../src/lib/docker.js';
import type { ContainerSpec } from '../../src/lib/docker.js';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

const SPEC: ContainerSpec = {
  challengeId: 'gatekeeper',
  targetImage: 'ghcr.io/kryptsec/gatekeeper:latest',
  kaliImage: 'ghcr.io/kryptsec/kali-base:latest',
  network: 'oasis-gatekeeper',
  kaliContainerName: 'oasis-gatekeeper-kali',
  targetContainerName: 'oasis-gatekeeper-target',
};

/** Helper: get all calls as [command, args] tuples */
function getCalls(): Array<[string, string[]]> {
  return mockExecFileSync.mock.calls.map(c => [c[0] as string, c[1] as string[]]);
}

/** Helper: filter calls by command prefix in args */
function getDockerCalls(subcommand: string): Array<[string, string[]]> {
  return getCalls().filter(([cmd, args]) => cmd === 'docker' && args[0] === subcommand);
}

// =============================================================================
// pullImage
// =============================================================================

describe('pullImage', () => {
  it('falls back to amd64 on manifest error', () => {
    mockExecFileSync
      .mockImplementationOnce(() => {
        const err: any = new Error('pull failed');
        err.stderr = 'no matching manifest for linux/arm64/v8';
        throw err;
      })
      .mockReturnValue('' as any);

    const result = pullImage('myimage:latest');
    expect(result).toBe(true);
    const pulls = getDockerCalls('pull');
    expect(pulls).toHaveLength(2);
    expect(pulls[1][1]).toContain('--platform');
    expect(pulls[1][1]).toContain('linux/amd64');
  });

  it('rethrows non-manifest errors without attempting fallback', () => {
    mockExecFileSync.mockImplementation(() => {
      const err: any = new Error('network timeout');
      err.stderr = 'connection refused';
      throw err;
    });

    expect(() => pullImage('myimage:latest')).toThrow('network timeout');
    const pulls = getDockerCalls('pull');
    expect(pulls).toHaveLength(1);
  });

  it('passes image name as a separate argument (no shell escaping needed)', () => {
    mockExecFileSync.mockReturnValue('' as any);
    pullImage("evil'image");
    const pulls = getDockerCalls('pull');
    // Image name is passed as a discrete array element, not interpolated into a shell string
    expect(pulls[0][1]).toContain("evil'image");
  });
});

// =============================================================================
// startContainers — per-image platform overrides
// =============================================================================

describe('startContainers', () => {
  it('applies platform only to target when only target needs it', () => {
    mockExecFileSync.mockReturnValue('' as any);
    startContainers(SPEC, { target: 'linux/amd64' });
    const runs = getDockerCalls('run');
    expect(runs).toHaveLength(2);
    expect(runs[0][1]).toContain('--platform');
    expect(runs[0][1]).toContain('linux/amd64');
    expect(runs[1][1]).not.toContain('--platform');
  });

  it('applies platform only to kali when only kali needs it', () => {
    mockExecFileSync.mockReturnValue('' as any);
    startContainers(SPEC, { kali: 'linux/amd64' });
    const runs = getDockerCalls('run');
    expect(runs).toHaveLength(2);
    expect(runs[0][1]).not.toContain('--platform');
    expect(runs[1][1]).toContain('--platform');
  });
});

// =============================================================================
// pullAndStartContainers — integrated flow
// =============================================================================

describe('pullAndStartContainers', () => {
  it('sets target platform only when target image needs amd64 fallback', () => {
    mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
      const argArr = args as string[];
      // First docker pull (target, no --platform) — manifest error
      if (cmd === 'docker' && argArr[0] === 'pull' && !argArr.includes('--platform') && argArr.includes(SPEC.targetImage)) {
        const err: any = new Error('fail');
        err.stderr = 'no matching manifest for linux/arm64/v8';
        throw err;
      }
      return '' as any;
    });

    pullAndStartContainers(SPEC);

    const runs = getDockerCalls('run');
    expect(runs).toHaveLength(2);
    // Target run should have platform
    expect(runs[0][1]).toContain('--platform');
    // Kali run should NOT
    expect(runs[1][1]).not.toContain('--platform');
  });

  it('reports progress via onProgress callback', () => {
    mockExecFileSync.mockReturnValue('' as any);
    const messages: string[] = [];
    pullAndStartContainers(SPEC, (msg) => messages.push(msg));
    expect(messages.some(m => m.includes('Pulling') && m.includes('gatekeeper'))).toBe(true);
    expect(messages.some(m => m.includes('Pulling') && m.includes('kali'))).toBe(true);
    expect(messages).toContain('Starting containers...');
  });
});

// =============================================================================
// ensureNetwork
// =============================================================================

describe('ensureNetwork', () => {
  it('creates network when inspect fails', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw new Error('not found'); })
      .mockReturnValue('' as any);
    ensureNetwork('test-net');
    const calls = getDockerCalls('network');
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(['network', 'create', 'test-net']);
  });
});

// =============================================================================
// cleanup / cleanupStale
// =============================================================================

describe('cleanup', () => {
  it('removes containers and network', () => {
    mockExecFileSync.mockReturnValue('' as any);
    cleanup(SPEC);
    const calls = getCalls();
    expect(calls.some(([cmd, args]) => cmd === 'docker' && args[0] === 'rm')).toBe(true);
    expect(calls.some(([cmd, args]) => cmd === 'docker' && args[0] === 'network' && args[1] === 'rm')).toBe(true);
  });

  it('ignores errors from rm and network rm', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('no such container'); });
    expect(() => cleanup(SPEC)).not.toThrow();
  });
});

describe('cleanupStale', () => {
  it('ignores errors when containers do not exist', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('no such container'); });
    expect(() => cleanupStale(SPEC)).not.toThrow();
  });
});
