/**
 * Integration test: verifies the thinking-tag fallback path in runOpenAIAgent.
 *
 * Simulates Qwen3 behavior: model returns <think>...</think> + raw JSON tool-call
 * as text content, with no structured tool_calls and finish_reason === 'stop'.
 * The runner should extract the command, execute it, and continue the loop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock OpenAI client ---
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
    },
  };
});

// --- Mock execFileSync (docker exec) ---
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

// --- Mock chalk to passthrough (cleaner assertions) ---
vi.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<any> = {
    get: () => new Proxy(passthrough, handler),
    apply: (_target: any, _this: any, args: any[]) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

import { runBenchmark } from '../../src/lib/runner.js';
import type { RunnerConfig } from '../../src/lib/types.js';

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    provider: 'ollama',
    modelId: 'qwen3:30b',
    apiKey: 'ollama',
    challenge: {
      id: 'test-challenge',
      name: 'Test Challenge',
      category: 'web',
      difficulty: 'easy',
      target: 'http://target:8080',
      flagFormat: 'KX{[a-f0-9]+}',
      description: 'Test',
      containerName: 'test-kali-1',
      limits: { maxIterations: 5, maxTimeSeconds: 30 },
    },
    maxIterations: 5,
    verbose: false,
    ...overrides,
  };
}

describe('runOpenAIAgent fallback extraction (Qwen3-style)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts command from thinking-tagged text when no tool_calls present', async () => {
    // Iteration 1: Qwen3-style response — thinking tags + raw JSON, no tool_calls
    // Iteration 2: model returns flag in text content, stops
    let callCount = 0;
    mockCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: `<think>
I need to explore the target. Let me start with a simple curl request.
</think>

{"name": "run_command", "arguments": {"command": "curl -s http://target:8080/"}}`,
              tool_calls: null,
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        };
      }
      // Second call: model finds the flag
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: 'I found the flag: KX{abc123}',
            tool_calls: null,
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      };
    });

    // Mock docker exec to return HTML with a hint
    mockExecFileSync.mockReturnValue('Welcome to the target app');

    const result = await runBenchmark(makeConfig());

    // The fallback path should have executed the command
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockExecFileSync.mock.calls[0];
    expect(cmd).toBe('docker');
    expect(args).toContain('test-kali-1');
    expect(opts.input).toBe('curl -s http://target:8080/');

    // Should have found the flag on iteration 2
    expect(result.success).toBe(true);
    expect(result.flag).toBe('KX{abc123}');
    expect(result.iterations).toBe(2);

    // Should have a tool_call step from the fallback extraction
    const toolSteps = result.steps.filter(s => s.type === 'tool_call');
    expect(toolSteps.length).toBe(1);
    expect(toolSteps[0].command).toBe('curl -s http://target:8080/');
  });

  it('finds flag in docker exec output via fallback path', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: `<think>Let me try to get the flag</think>
{"name":"run_command","arguments":{"command":"cat /flag.txt"}}`,
          tool_calls: null,
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    // Command output contains the flag
    mockExecFileSync.mockReturnValue('KX{deadbeef42}');

    const result = await runBenchmark(makeConfig());

    expect(result.success).toBe(true);
    expect(result.flag).toBe('KX{deadbeef42}');
    expect(result.iterations).toBe(1);
  });

  it('breaks on stop when no command can be extracted from text', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: '<think>I give up, I cannot find anything.</think>\nI was unable to find the flag.',
          tool_calls: null,
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    const result = await runBenchmark(makeConfig());

    expect(result.success).toBe(false);
    expect(result.flag).toBeNull();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('strips thinking tags from reasoning stored in steps', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: `<think>Internal reasoning that should be stripped</think>
{"name":"run_command","arguments":{"command":"id"}}`,
          tool_calls: null,
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    mockExecFileSync.mockReturnValue('uid=0(root)');

    // Need a second call to end the loop
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Done.',
          tool_calls: null,
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 150, completion_tokens: 10 },
    });

    const result = await runBenchmark(makeConfig());

    const toolStep = result.steps.find(s => s.type === 'tool_call');
    expect(toolStep).toBeDefined();
    // Reasoning should NOT contain <think> tags
    expect(toolStep!.reasoning).not.toContain('<think>');
    expect(toolStep!.reasoning).not.toContain('</think>');
  });

  it('handles <tool_call> wrapper tags from some models', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          role: 'assistant',
          content: `<think>thinking</think>
<tool_call>{"name":"run_command","arguments":{"command":"whoami"}}</tool_call>`,
          tool_calls: null,
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    mockExecFileSync.mockReturnValue('root');

    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: { role: 'assistant', content: 'Stopping.', tool_calls: null },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 150, completion_tokens: 10 },
    });

    const result = await runBenchmark(makeConfig());

    const toolStep = result.steps.find(s => s.type === 'tool_call');
    expect(toolStep).toBeDefined();
    expect(toolStep!.command).toBe('whoami');
  });

  it('feeds command output back as user message for next iteration', async () => {
    let callCount = 0;
    mockCreate.mockImplementation(async ({ messages }: any) => {
      callCount++;
      if (callCount === 1) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: `<think>recon</think>{"name":"run_command","arguments":{"command":"ls"}}`,
              tool_calls: null,
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        };
      }
      // On second call, verify the messages include the user feedback
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toContain('Command output:');
      expect(lastMsg.content).toContain('file1.txt');

      return {
        choices: [{
          message: { role: 'assistant', content: 'Done.', tool_calls: null },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 200, completion_tokens: 10 },
      };
    });

    mockExecFileSync.mockReturnValue('file1.txt\nfile2.txt');

    await runBenchmark(makeConfig());

    expect(callCount).toBe(2);
  });
});
