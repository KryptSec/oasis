import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
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
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

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

// =============================================================================
// pullImage
// =============================================================================

describe('pullImage', () => {
  it('returns false when native pull succeeds', () => {
    mockExecSync.mockReturnValue('' as any);
    const result = pullImage('myimage:latest');
    expect(result).toBe(false);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect((mockExecSync.mock.calls[0][0] as string)).toContain('docker pull');
    expect((mockExecSync.mock.calls[0][0] as string)).not.toContain('--platform');
  });

  it('returns true when native pull fails with manifest error and amd64 fallback succeeds', () => {
    mockExecSync
      .mockImplementationOnce(() => {
        const err: any = new Error('pull failed');
        err.stderr = 'no matching manifest for linux/arm64/v8';
        throw err;
      })
      .mockReturnValueOnce('' as any); // amd64 fallback succeeds

    const result = pullImage('myimage:latest');
    expect(result).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect((mockExecSync.mock.calls[1][0] as string)).toContain('--platform linux/amd64');
  });

  it('also catches "no match for platform" variant', () => {
    mockExecSync
      .mockImplementationOnce(() => {
        const err: any = new Error('pull failed');
        err.stderr = 'no match for platform';
        throw err;
      })
      .mockReturnValueOnce('' as any);

    const result = pullImage('myimage:latest');
    expect(result).toBe(true);
  });

  it('rethrows non-manifest errors without attempting fallback', () => {
    mockExecSync.mockImplementation(() => {
      const err: any = new Error('network timeout');
      err.stderr = 'connection refused';
      throw err;
    });

    expect(() => pullImage('myimage:latest')).toThrow('network timeout');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('calls onProgress callback during pull', () => {
    mockExecSync.mockReturnValue('' as any);
    const messages: string[] = [];
    pullImage('myimage:latest', (msg) => messages.push(msg));
    expect(messages).toContain('Pulling myimage:latest...');
  });

  it('calls onProgress for fallback path', () => {
    mockExecSync
      .mockImplementationOnce(() => {
        const err: any = new Error('fail');
        err.stderr = 'no matching manifest';
        throw err;
      })
      .mockReturnValueOnce('' as any);

    const messages: string[] = [];
    pullImage('myimage:latest', (msg) => messages.push(msg));
    expect(messages).toContain('Pulling myimage:latest...');
    expect(messages).toContain('Pulling myimage:latest (linux/amd64 fallback)...');
  });

  it('shell-escapes the image name', () => {
    mockExecSync.mockReturnValue('' as any);
    pullImage("evil'image");
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("'evil'\\''image'");
  });
});

// =============================================================================
// startContainers — per-image platform overrides
// =============================================================================

describe('startContainers', () => {
  it('runs both containers without platform flag when no overrides', () => {
    mockExecSync.mockReturnValue('' as any);
    startContainers(SPEC);
    // cleanupStale + ensureNetwork inspect/create + 2 docker run = at least 4 calls
    const runCalls = mockExecSync.mock.calls
      .map(c => c[0] as string)
      .filter(c => c.startsWith('docker run'));
    expect(runCalls).toHaveLength(2);
    for (const cmd of runCalls) {
      expect(cmd).not.toContain('--platform');
    }
  });

  it('applies platform only to target when only target needs it', () => {
    mockExecSync.mockReturnValue('' as any);
    startContainers(SPEC, { target: 'linux/amd64' });
    const runCalls = mockExecSync.mock.calls
      .map(c => c[0] as string)
      .filter(c => c.startsWith('docker run'));
    expect(runCalls).toHaveLength(2);
    // Target should have --platform
    expect(runCalls[0]).toContain('--platform');
    expect(runCalls[0]).toContain('linux/amd64');
    // Kali should NOT have --platform
    expect(runCalls[1]).not.toContain('--platform');
  });

  it('applies platform only to kali when only kali needs it', () => {
    mockExecSync.mockReturnValue('' as any);
    startContainers(SPEC, { kali: 'linux/amd64' });
    const runCalls = mockExecSync.mock.calls
      .map(c => c[0] as string)
      .filter(c => c.startsWith('docker run'));
    expect(runCalls).toHaveLength(2);
    expect(runCalls[0]).not.toContain('--platform');
    expect(runCalls[1]).toContain('--platform');
  });

  it('applies platform to both when both need it', () => {
    mockExecSync.mockReturnValue('' as any);
    startContainers(SPEC, { target: 'linux/amd64', kali: 'linux/amd64' });
    const runCalls = mockExecSync.mock.calls
      .map(c => c[0] as string)
      .filter(c => c.startsWith('docker run'));
    expect(runCalls).toHaveLength(2);
    expect(runCalls[0]).toContain('--platform');
    expect(runCalls[1]).toContain('--platform');
  });
});

// =============================================================================
// pullAndStartContainers — integrated flow
// =============================================================================

describe('pullAndStartContainers', () => {
  it('pulls both images and starts without platform when both native', () => {
    mockExecSync.mockReturnValue('' as any);
    pullAndStartContainers(SPEC);

    const pullCalls = mockExecSync.mock.calls
      .map(c => c[0] as string)
      .filter(c => c.includes('docker pull'));
    expect(pullCalls).toHaveLength(2);

    const runCalls = mockExecSync.mock.calls
      .map(c => c[0] as string)
      .filter(c => c.startsWith('docker run'));
    for (const cmd of runCalls) {
      expect(cmd).not.toContain('--platform');
    }
  });

  it('sets target platform only when target image needs amd64 fallback', () => {
    let callIdx = 0;
    mockExecSync.mockImplementation((cmd: unknown) => {
      const cmdStr = cmd as string;
      callIdx++;
      // First docker pull (target) — manifest error
      if (cmdStr.includes('docker pull') && !cmdStr.includes('--platform') && cmdStr.includes('gatekeeper')) {
        const err: any = new Error('fail');
        err.stderr = 'no matching manifest for linux/arm64/v8';
        throw err;
      }
      return '' as any;
    });

    pullAndStartContainers(SPEC);

    const runCalls = mockExecSync.mock.calls
      .map(c => c[0] as string)
      .filter(c => c.startsWith('docker run'));
    expect(runCalls).toHaveLength(2);
    // Target run should have platform
    expect(runCalls[0]).toContain('--platform');
    // Kali run should NOT
    expect(runCalls[1]).not.toContain('--platform');
  });

  it('reports progress via onProgress callback', () => {
    mockExecSync.mockReturnValue('' as any);
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
  it('does not create network if inspect succeeds', () => {
    mockExecSync.mockReturnValue('' as any);
    ensureNetwork('test-net');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect((mockExecSync.mock.calls[0][0] as string)).toContain('network inspect');
  });

  it('creates network when inspect fails', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('not found'); })
      .mockReturnValueOnce('' as any);
    ensureNetwork('test-net');
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect((mockExecSync.mock.calls[1][0] as string)).toContain('network create');
  });
});

// =============================================================================
// cleanup / cleanupStale
// =============================================================================

describe('cleanup', () => {
  it('removes containers and network', () => {
    mockExecSync.mockReturnValue('' as any);
    cleanup(SPEC);
    const cmds = mockExecSync.mock.calls.map(c => c[0] as string);
    expect(cmds.some(c => c.includes('docker rm -f'))).toBe(true);
    expect(cmds.some(c => c.includes('network rm'))).toBe(true);
  });

  it('ignores errors from rm and network rm', () => {
    mockExecSync.mockImplementation(() => { throw new Error('no such container'); });
    expect(() => cleanup(SPEC)).not.toThrow();
  });
});

describe('cleanupStale', () => {
  it('ignores errors when containers do not exist', () => {
    mockExecSync.mockImplementation(() => { throw new Error('no such container'); });
    expect(() => cleanupStale(SPEC)).not.toThrow();
  });
});
