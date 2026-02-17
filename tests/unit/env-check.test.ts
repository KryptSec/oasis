import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import {
  checkDockerRunning,
  checkContainersRunning,
  checkTargetReachable,
  checkKaliTools,
  checkApiKey,
  runPreflightChecks,
} from '../../src/lib/env-check.js';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

// Mock Anthropic SDK (dynamic import)
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

// Mock OpenAI SDK (dynamic import)
const mockOpenAIModelsList = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn(() => ({
    models: { list: mockOpenAIModelsList },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// checkDockerRunning
// =============================================================================

describe('checkDockerRunning', () => {
  it('returns ok when docker ps succeeds', () => {
    mockExecSync.mockReturnValue('CONTAINER ID  IMAGE  ...\n' as any);
    const result = checkDockerRunning();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when docker ps throws', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('Cannot connect to Docker daemon');
    });
    const result = checkDockerRunning();
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Docker is not running or not accessible');
  });

  it('includes helpful hints on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not running');
    });
    const result = checkDockerRunning();
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.some((h) => h.includes('Docker Desktop'))).toBe(true);
  });
});

// =============================================================================
// checkContainersRunning
// =============================================================================

describe('checkContainersRunning', () => {
  const challengeId = 'gatekeeper';
  const containerName = 'gatekeeper-kali-1';

  it('returns ok when both containers are Up', () => {
    mockExecSync.mockReturnValue(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when target container is missing', () => {
    mockExecSync.mockReturnValue('gatekeeper-kali-1\tUp 5 minutes\n' as any);
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('gatekeeper-target-1'))).toBe(true);
  });

  it('returns error when target container is Exited', () => {
    mockExecSync.mockReturnValue(
      'gatekeeper-target-1\tExited (1) 2 minutes ago\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not running') && e.includes('Exited'))).toBe(
      true
    );
  });

  it('returns error when kali container is missing', () => {
    mockExecSync.mockReturnValue('gatekeeper-target-1\tUp 5 minutes\n' as any);
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('gatekeeper-kali-1'))).toBe(true);
  });

  it('returns error when kali container is Exited', () => {
    mockExecSync.mockReturnValue(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tExited (0) 1 minute ago\n' as any
    );
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes('gatekeeper-kali-1') && e.includes('not running'))
    ).toBe(true);
  });

  it('returns error when execSync throws', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('docker failed');
    });
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Failed to check container status');
  });
});

// =============================================================================
// checkTargetReachable
// =============================================================================

describe('checkTargetReachable', () => {
  const container = 'gatekeeper-kali-1';
  const url = 'http://target:5000';

  it('returns ok when curl returns 200', () => {
    mockExecSync.mockReturnValue('200' as any);
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(true);
  });

  it('returns ok when curl returns 404 (connected)', () => {
    mockExecSync.mockReturnValue('404' as any);
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(true);
  });

  it('returns error when curl returns 000 (not reachable)', () => {
    mockExecSync.mockReturnValue('000' as any);
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not reachable'))).toBe(true);
  });

  it('returns error when curl returns FAIL', () => {
    mockExecSync.mockReturnValue('FAIL' as any);
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not reachable'))).toBe(true);
  });

  it('returns error when execSync throws (curl missing)', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('exec failed');
    });
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('curl may be missing'))).toBe(true);
  });

  it('shell-escapes containerName and targetUrl in exec call', () => {
    mockExecSync.mockReturnValue('200' as any);
    checkTargetReachable("evil'name", "http://x';rm -rf /");
    const cmd = mockExecSync.mock.calls[0][0] as string;
    // Values should be wrapped in single quotes with escaped internal quotes
    expect(cmd).toContain("'evil'\\''name'");
    expect(cmd).toContain("'http://x'\\''");
    // The injected command should be inside single quotes, not a bare shell token
    expect(cmd).not.toMatch(/[^'];\s*rm\s/);
  });
});

// =============================================================================
// checkKaliTools
// =============================================================================

describe('checkKaliTools', () => {
  const container = 'gatekeeper-kali-1';

  it('returns ok when all tools are found', () => {
    mockExecSync.mockReturnValue('/usr/bin/tool' as any);
    const result = checkKaliTools(container);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when one tool is missing', () => {
    mockExecSync
      .mockReturnValueOnce('/usr/bin/curl' as any) // curl found
      .mockImplementationOnce(() => {
        throw new Error('not found');
      }) // wget missing
      .mockReturnValueOnce('/usr/bin/python3' as any); // python3 found

    const result = checkKaliTools(container);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('wget');
  });

  it('returns multiple errors and hints when multiple tools missing', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = checkKaliTools(container);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.some((h) => h.includes('Rebuild'))).toBe(true);
  });

  it('shell-escapes containerName in exec call', () => {
    mockExecSync.mockReturnValue('/usr/bin/tool' as any);
    checkKaliTools("evil'name");
    for (const call of mockExecSync.mock.calls) {
      const cmd = call[0] as string;
      expect(cmd).toContain("'evil'\\''name'");
    }
  });
});

// =============================================================================
// checkApiKey
// =============================================================================

describe('checkApiKey', () => {
  it('anthropic: returns ok on successful call', async () => {
    mockAnthropicCreate.mockResolvedValue({ id: 'msg_123' });
    const result = await checkApiKey('anthropic', 'sk-ant-test');
    expect(result.ok).toBe(true);
  });

  it('anthropic: returns error on 401', async () => {
    mockAnthropicCreate.mockRejectedValue({ status: 401 });
    const result = await checkApiKey('anthropic', 'sk-bad-key');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid'))).toBe(true);
    expect(result.hints.some((h) => h.includes('oasis config set'))).toBe(true);
  });

  it('anthropic: returns error on network failure', async () => {
    mockAnthropicCreate.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkApiKey('anthropic', 'sk-ant-test');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Could not validate'))).toBe(true);
    expect(result.hints.some((h) => h.includes('network'))).toBe(true);
  });

  it('anthropic: treats 404 (model deprecated) as valid key', async () => {
    mockAnthropicCreate.mockRejectedValue({ status: 404 });
    const result = await checkApiKey('anthropic', 'sk-ant-test');
    expect(result.ok).toBe(true);
  });

  it('openai: returns ok on successful call', async () => {
    mockOpenAIModelsList.mockResolvedValue({ data: [] });
    const result = await checkApiKey('openai', 'sk-openai-test');
    expect(result.ok).toBe(true);
  });

  it('openai: returns error on 401', async () => {
    mockOpenAIModelsList.mockRejectedValue({ status: 401 });
    const result = await checkApiKey('openai', 'sk-bad');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid'))).toBe(true);
  });

  it('ollama: skips validation and returns ok', async () => {
    const result = await checkApiKey('ollama', '');
    expect(result.ok).toBe(true);
  });

  it('includes baseUrl in hints when provided and validation fails', async () => {
    mockOpenAIModelsList.mockRejectedValue(new Error('timeout'));
    const result = await checkApiKey('openai', 'sk-test', 'https://custom.api/v1');
    expect(result.ok).toBe(false);
    expect(result.hints.some((h) => h.includes('https://custom.api/v1'))).toBe(true);
  });
});

// =============================================================================
// runPreflightChecks
// =============================================================================

describe('runPreflightChecks', () => {
  const challengeId = 'gatekeeper';
  const challengeDir = '/challenges/gatekeeper';
  const containerName = 'gatekeeper-kali-1';
  const targetUrl = 'http://target:5000';

  function mockAllChecksPass() {
    // docker ps
    mockExecSync.mockReturnValueOnce('' as any);
    // docker ps -a (containers)
    mockExecSync.mockReturnValueOnce(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    // curl check
    mockExecSync.mockReturnValueOnce('200' as any);
    // which curl, which wget, which python3
    mockExecSync.mockReturnValueOnce('/usr/bin/curl' as any);
    mockExecSync.mockReturnValueOnce('/usr/bin/wget' as any);
    mockExecSync.mockReturnValueOnce('/usr/bin/python3' as any);
  }

  it('returns ok when all checks pass', () => {
    mockAllChecksPass();
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(true);
  });

  it('returns docker error on early failure (docker not running)', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('docker not found');
    });
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Docker is not running or not accessible');
  });

  it('returns container error when docker ok but containers fail', () => {
    // docker ps succeeds
    mockExecSync.mockReturnValueOnce('' as any);
    // docker ps -a returns no containers
    mockExecSync.mockReturnValueOnce('' as any);
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not found'))).toBe(true);
  });

  it('returns tools error when other checks pass but tools missing', () => {
    // docker ps
    mockExecSync.mockReturnValueOnce('' as any);
    // docker ps -a (containers)
    mockExecSync.mockReturnValueOnce(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    // curl check succeeds
    mockExecSync.mockReturnValueOnce('200' as any);
    // all tools missing
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Required tool'))).toBe(true);
  });
});
