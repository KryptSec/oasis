import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import {
  checkDockerRunning,
  ensureDocker,
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
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

// Mock Anthropic SDK (dynamic import)
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

// Mock OpenAI SDK (dynamic import)
const mockOpenAIModelsList = vi.fn();
const mockOpenAIChatCreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn(() => ({
    models: { list: mockOpenAIModelsList },
    chat: { completions: { create: mockOpenAIChatCreate } },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/** Helper to match calls by command and first arg */
function matchCall(cmd: string, firstArg?: string): (call: unknown[]) => boolean {
  return (call: unknown[]) => {
    if (call[0] !== cmd) return false;
    if (firstArg === undefined) return true;
    const args = call[1] as string[];
    return args?.[0] === firstArg;
  };
}

// =============================================================================
// checkDockerRunning
// =============================================================================

describe('checkDockerRunning', () => {
  it('returns ok when docker ps succeeds', () => {
    mockExecFileSync.mockReturnValue('CONTAINER ID  IMAGE  ...\n' as any);
    const result = checkDockerRunning();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when docker ps throws', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('Cannot connect to Docker daemon');
    });
    const result = checkDockerRunning();
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Docker is not running or not accessible');
  });

  it('includes helpful hints on failure', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not running');
    });
    const result = checkDockerRunning();
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.some((h) => h.includes('Docker Desktop'))).toBe(true);
  });
});

// =============================================================================
// ensureDocker
// =============================================================================

describe('ensureDocker', () => {
  const originalPlatform = process.platform;

  function setPlatform(value: string) {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns immediately when Docker is already running', async () => {
    mockExecFileSync.mockReturnValueOnce('' as any); // docker ps succeeds
    const result = await ensureDocker();
    expect(result.ok).toBe(true);
    expect(result.autoStarted).toBe(false);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns error on non-macOS when Docker is not running', async () => {
    setPlatform('linux');
    mockExecFileSync.mockImplementation(() => { throw new Error('not running'); });
    const result = await ensureDocker();
    expect(result.ok).toBe(false);
    expect(result.autoStarted).toBe(false);
    expect(result.errors).toContain('Docker is not running or not accessible');
    expect(result.hints.some((h) => h.includes('Start Docker Desktop'))).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('auto-starts Docker Desktop on macOS and polls until ready', async () => {
    setPlatform('darwin');
    let callCount = 0;
    mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
      callCount++;
      const argArr = args as string[];
      // open --background -a Docker
      if (cmd === 'open') return '' as any;
      // docker ps — fail first two, then succeed
      if (cmd === 'docker' && argArr[0] === 'ps') {
        if (callCount <= 2) throw new Error('not running');
        return '' as any;
      }
      throw new Error('unexpected command');
    });

    const result = await ensureDocker(undefined, 60_000);
    expect(result.ok).toBe(true);
    expect(result.autoStarted).toBe(true);
  });

  it('returns error when open command fails on macOS', async () => {
    setPlatform('darwin');
    mockExecFileSync.mockImplementation((cmd: unknown) => {
      if (cmd === 'docker') throw new Error('not running');
      if (cmd === 'open') throw new Error('app not found');
      throw new Error('unexpected');
    });

    const result = await ensureDocker();
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Failed to start Docker Desktop');
    expect(result.hints.some((h) => h.includes('Install Docker Desktop'))).toBe(true);
  });

  it('returns timeout error when Docker never becomes ready', async () => {
    setPlatform('darwin');
    mockExecFileSync.mockImplementation((cmd: unknown) => {
      if (cmd === 'open') return '' as any;
      throw new Error('not running');
    });

    const result = await ensureDocker(undefined, 100); // very short timeout
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Docker Desktop failed to start within timeout');
  });

  it('calls onStatus callback with progress messages', async () => {
    setPlatform('darwin');
    let callCount = 0;
    mockExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
      callCount++;
      const argArr = args as string[];
      if (cmd === 'open') return '' as any;
      if (cmd === 'docker' && argArr[0] === 'ps') {
        if (callCount <= 2) throw new Error('not running');
        return '' as any;
      }
      throw new Error('unexpected');
    });

    const messages: string[] = [];
    const onStatus = (msg: string) => { messages.push(msg); };

    await ensureDocker(onStatus, 60_000);
    expect(messages.some((m) => m.includes('Starting Docker Desktop'))).toBe(true);
    expect(messages.some((m) => m.includes('Waiting for Docker to be ready'))).toBe(true);
  });
});

// =============================================================================
// checkContainersRunning
// =============================================================================

describe('checkContainersRunning', () => {
  const challengeId = 'gatekeeper';
  const containerName = 'gatekeeper-kali-1';

  it('returns ok when both containers are Up', () => {
    mockExecFileSync.mockReturnValue(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when target container is missing', () => {
    mockExecFileSync.mockReturnValue('gatekeeper-kali-1\tUp 5 minutes\n' as any);
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('gatekeeper-target-1'))).toBe(true);
  });

  it('returns error when target container is Exited', () => {
    mockExecFileSync.mockReturnValue(
      'gatekeeper-target-1\tExited (1) 2 minutes ago\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not running') && e.includes('Exited'))).toBe(
      true
    );
  });

  it('returns error when kali container is missing', () => {
    mockExecFileSync.mockReturnValue('gatekeeper-target-1\tUp 5 minutes\n' as any);
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('gatekeeper-kali-1'))).toBe(true);
  });

  it('returns error when kali container is Exited', () => {
    mockExecFileSync.mockReturnValue(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tExited (0) 1 minute ago\n' as any
    );
    const result = checkContainersRunning(challengeId, containerName);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes('gatekeeper-kali-1') && e.includes('not running'))
    ).toBe(true);
  });

  it('returns error when execFileSync throws', () => {
    mockExecFileSync.mockImplementation(() => {
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
    mockExecFileSync.mockReturnValue('200' as any);
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(true);
  });

  it('returns ok when curl returns 404 (connected)', () => {
    mockExecFileSync.mockReturnValue('404' as any);
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(true);
  });

  it('returns error when curl returns 000 (not reachable)', () => {
    mockExecFileSync.mockReturnValue('000' as any);
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not reachable'))).toBe(true);
  });

  it('returns error when curl throws (treated as FAIL)', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('exec failed');
    });
    const result = checkTargetReachable(container, url);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not reachable'))).toBe(true);
  });

  it('passes containerName and targetUrl as separate arguments (no shell escaping needed)', () => {
    mockExecFileSync.mockReturnValue('200' as any);
    checkTargetReachable("evil'name", "http://x';rm -rf /");
    const call = mockExecFileSync.mock.calls[0];
    const args = call[1] as string[];
    // With execFileSync, arguments are passed directly — no shell involved
    expect(call[0]).toBe('docker');
    expect(args).toContain("evil'name");
    expect(args).toContain("http://x';rm -rf /");
  });
});

// =============================================================================
// checkKaliTools
// =============================================================================

describe('checkKaliTools', () => {
  const container = 'gatekeeper-kali-1';

  it('returns ok when all tools are found', () => {
    mockExecFileSync.mockReturnValue('/usr/bin/tool' as any);
    const result = checkKaliTools(container);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when one tool is missing', () => {
    mockExecFileSync
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
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = checkKaliTools(container);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.some((h) => h.includes('Rebuild'))).toBe(true);
  });

  it('passes containerName as a separate argument (no shell escaping needed)', () => {
    mockExecFileSync.mockReturnValue('/usr/bin/tool' as any);
    checkKaliTools("evil'name");
    for (const call of mockExecFileSync.mock.calls) {
      const args = call[1] as string[];
      // Container name is a discrete array element, not interpolated into a shell string
      expect(args).toContain("evil'name");
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

  it('xai: returns ok on successful chat completion', async () => {
    mockOpenAIChatCreate.mockResolvedValue({ id: 'chatcmpl-123' });
    const result = await checkApiKey('xai', 'xai-test-key');
    expect(result.ok).toBe(true);
  });

  it('xai: returns error on 401', async () => {
    mockOpenAIChatCreate.mockRejectedValue({ status: 401 });
    const result = await checkApiKey('xai', 'xai-bad-key');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid'))).toBe(true);
    expect(result.hints.some((h) => h.includes('oasis config set'))).toBe(true);
  });

  it('xai: treats 400 "Incorrect API key" as invalid key', async () => {
    mockOpenAIChatCreate.mockRejectedValue({
      status: 400,
      message: '400 "Incorrect API key provided: xa***23."',
    });
    const result = await checkApiKey('xai', 'xai-bad-key');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid'))).toBe(true);
  });

  it('xai: treats 403 with credits message as valid key', async () => {
    mockOpenAIChatCreate.mockRejectedValue({
      status: 403,
      message: '403 "Your newly created team doesn\'t have any credits or licenses yet."',
    });
    const result = await checkApiKey('xai', 'xai-test-key');
    expect(result.ok).toBe(true);
    expect(result.hints.some((h) => h.includes('credit'))).toBe(true);
  });

  it('xai: treats 404 (model not found) as valid key', async () => {
    mockOpenAIChatCreate.mockRejectedValue({ status: 404 });
    const result = await checkApiKey('xai', 'xai-test-key');
    expect(result.ok).toBe(true);
  });

  it('xai: returns error on network failure', async () => {
    mockOpenAIChatCreate.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkApiKey('xai', 'xai-test-key');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Could not validate'))).toBe(true);
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
    mockExecFileSync.mockReturnValueOnce('' as any);
    // docker ps -a (containers)
    mockExecFileSync.mockReturnValueOnce(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    // curl check
    mockExecFileSync.mockReturnValueOnce('200' as any);
    // which curl, which wget, which python3
    mockExecFileSync.mockReturnValueOnce('/usr/bin/curl' as any);
    mockExecFileSync.mockReturnValueOnce('/usr/bin/wget' as any);
    mockExecFileSync.mockReturnValueOnce('/usr/bin/python3' as any);
  }

  it('returns ok when all checks pass', () => {
    mockAllChecksPass();
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(true);
  });

  it('returns docker error on early failure (docker not running)', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('docker not found');
    });
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Docker is not running or not accessible');
  });

  it('returns container error when docker ok but containers fail', () => {
    // docker ps succeeds
    mockExecFileSync.mockReturnValueOnce('' as any);
    // docker ps -a returns no containers
    mockExecFileSync.mockReturnValueOnce('' as any);
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not found'))).toBe(true);
  });

  it('returns tools error when other checks pass but tools missing', () => {
    // docker ps
    mockExecFileSync.mockReturnValueOnce('' as any);
    // docker ps -a (containers)
    mockExecFileSync.mockReturnValueOnce(
      'gatekeeper-target-1\tUp 5 minutes\ngatekeeper-kali-1\tUp 5 minutes\n' as any
    );
    // curl check succeeds
    mockExecFileSync.mockReturnValueOnce('200' as any);
    // all tools missing
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = runPreflightChecks(challengeId, challengeDir, containerName, targetUrl);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Required tool'))).toBe(true);
  });
});
