// Integration tests for harness mid-run budget enforcement
// These tests invoke the REAL runBenchmark/agent functions with mocked API clients

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI client
const mockOpenAICreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockOpenAICreate } };
    },
  };
});

// Mock Anthropic client
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockAnthropicCreate };
    },
  };
});

// Mock execFileSync (docker exec) — returns empty string by default
const mockExecFileSync = vi.fn().mockReturnValue('');
vi.mock('child_process', () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
  execSync: vi.fn(),
}));

// Mock chalk for cleaner output
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
import type { HarnessConfig } from '../../src/harness/types.js';

describe('Harness Mid-Run Budget Integration Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
    mockExecFileSync.mockReturnValue('');
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  describe('Claude Agent (Anthropic)', () => {
    it('should stop mid-run when step budget exceeded with hardStop=true', async () => {
      // Mock Anthropic to return responses that keep the loop going (max_tokens, not end_turn)
      mockAnthropicCreate.mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Exploring...' }],
        model: 'claude-test',
        stop_reason: 'max_tokens',  // Don't naturally stop
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      });
      
      const harnessConfig: HarnessConfig = {
        enabled: true,
        mode: 'single-model',
        budget: { maxSteps: 3, hardStop: true },
        verifyBeforeClaim: true,
        coverageLedger: false,
      };
      
      const config: RunnerConfig = {
        provider: 'anthropic',
        modelId: 'claude-test',
        apiKey: 'test-key',
        challenge: {
          id: 'test',
          name: 'Test',
          category: 'test',
          difficulty: 'easy',
          target: 'http://localhost',
          flagFormat: 'KX{*}',
          description: 'Test',
          containerName: 'test-kali-1',
        },
        maxIterations: 100,
        verbose: false,
        harnessConfig,
      };
      
      const result = await runBenchmark(config);
      
      // Proves mid-run stop: stopped at iteration 3 (budget check fires AFTER iterations++, BEFORE API call)
      // So: iter 1 (call 1), iter 2 (call 2), iter 3 (check fires, no call 3)
      expect(result.iterations).toBe(3);
      expect(result.error).not.toBeNull();
      expect(result.error).toContain('Harness budget exceeded');
      expect(result.error).toContain('Step budget exceeded');
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);  // 2 calls before stop
      expect(result.success).toBe(false);
      
      // Verify trackBudget also shows exceeded (>= semantics, not >)
      const { trackBudget } = await import('../../src/harness/runner.js');
      const budgetStatus = trackBudget(result, harnessConfig);
      expect(budgetStatus.steps.exceeded).toBe(true);
      expect(budgetStatus.overallExceeded).toBe(true);
    });
    
    it('should stop mid-run when token budget exceeded', async () => {
      mockAnthropicCreate.mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Testing' }],
        model: 'claude-test',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 5000, output_tokens: 5000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      });
      
      const harnessConfig: HarnessConfig = {
        enabled: true,
        mode: 'single-model',
        budget: { maxTokens: 15000, hardStop: true },  // Should stop after 2 iterations (20k tokens)
        verifyBeforeClaim: true,
        coverageLedger: false,
      };
      
      const config: RunnerConfig = {
        provider: 'anthropic',
        modelId: 'claude-test',
        apiKey: 'test-key',
        challenge: {
          id: 'test',
          name: 'Test',
          category: 'test',
          difficulty: 'easy',
          target: 'http://localhost',
          flagFormat: 'KX{*}',
          description: 'Test',
          containerName: 'test-kali-1',
        },
        maxIterations: 100,
        verbose: false,
        harnessConfig,
      };
      
      const result = await runBenchmark(config);
      
      // Proves token budget triggers mid-run stop
      // iter 1: 10k tokens, iter 2: 20k tokens (exceeds 15k), iter 3: check fires before API call
      expect(result.iterations).toBe(3);
      expect(result.tokens.total).toBe(20000);  // 2 API calls × 10k tokens
      expect(result.error).not.toBeNull();
      expect(result.error).toContain('Harness budget exceeded');
      expect(result.error).toContain('Token budget exceeded');
    });
    
    it('should NOT stop when hardStop=false even if budget exceeded', async () => {
      mockAnthropicCreate.mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Testing' }],
        model: 'claude-test',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      });
      
      const harnessConfig: HarnessConfig = {
        enabled: true,
        mode: 'single-model',
        budget: { maxSteps: 2, hardStop: false },  // Soft limit
        verifyBeforeClaim: true,
        coverageLedger: false,
      };
      
      const config: RunnerConfig = {
        provider: 'anthropic',
        modelId: 'claude-test',
        apiKey: 'test-key',
        challenge: {
          id: 'test',
          name: 'Test',
          category: 'test',
          difficulty: 'easy',
          target: 'http://localhost',
          flagFormat: 'KX{*}',
          description: 'Test',
          containerName: 'test-kali-1',
        },
        maxIterations: 5,
        verbose: false,
        harnessConfig,
      };
      
      const result = await runBenchmark(config);
      
      // Proves soft limit doesn't trigger mid-run stop
      expect(result.iterations).toBe(5);
      expect(result.error).toBeNull();
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(5);
    });
  });
  
  describe('OpenAI-Compatible Agent', () => {
    it('should stop mid-run when step budget exceeded with hardStop=true', async () => {
      mockOpenAICreate.mockResolvedValue({
        id: 'chatcmpl_test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Exploring...' },
          finish_reason: 'length',  // Don't naturally stop
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
      
      const harnessConfig: HarnessConfig = {
        enabled: true,
        mode: 'single-model',
        budget: { maxSteps: 3, hardStop: true },
        verifyBeforeClaim: true,
        coverageLedger: false,
      };
      
      const config: RunnerConfig = {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
        challenge: {
          id: 'test',
          name: 'Test',
          category: 'test',
          difficulty: 'easy',
          target: 'http://localhost',
          flagFormat: 'KX{*}',
          description: 'Test',
          containerName: 'test-kali-1',
        },
        maxIterations: 100,
        verbose: false,
        harnessConfig,
      };
      
      const result = await runBenchmark(config);
      
      // Proves OpenAI agent also stops mid-run at iter 3, 2 API calls
      expect(result.iterations).toBe(3);
      expect(result.error).not.toBeNull();
      expect(result.error).toContain('Harness budget exceeded');
      expect(result.error).toContain('Step budget exceeded');
      expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(false);
    });
    
    it('should NOT stop when harness disabled even if budget would be exceeded', async () => {
      mockOpenAICreate.mockResolvedValue({
        id: 'chatcmpl_test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Testing' },
          finish_reason: 'length',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
      
      const harnessConfig: HarnessConfig = {
        enabled: false,  // Harness disabled
        mode: 'single-model',
        budget: { maxSteps: 2, hardStop: true },
        verifyBeforeClaim: true,
        coverageLedger: false,
      };
      
      const config: RunnerConfig = {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
        challenge: {
          id: 'test',
          name: 'Test',
          category: 'test',
          difficulty: 'easy',
          target: 'http://localhost',
          flagFormat: 'KX{*}',
          description: 'Test',
          containerName: 'test-kali-1',
        },
        maxIterations: 5,
        verbose: false,
        harnessConfig,
      };
      
      const result = await runBenchmark(config);
      
      // Proves harness.enabled=false disables budget check
      expect(result.iterations).toBe(5);
      expect(result.error).toBeNull();
      expect(mockOpenAICreate).toHaveBeenCalledTimes(5);
    });
  });
});
