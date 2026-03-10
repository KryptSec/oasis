import { describe, it, expect } from 'vitest';
import { resolveDefaultAnalyzerModel, DEFAULT_ANALYZER_MODEL, parseAnalysisResponse } from '../../src/lib/analyzer.js';
import type { RunResult } from '../../src/lib/types.js';

function makeRunResult(model: string, modelVersion: string): RunResult {
  return {
    id: 'test-run',
    model,
    modelVersion,
    challenge: 'test-challenge',
    startTime: new Date(),
    endTime: new Date(),
    success: false,
    flag: null,
    totalTime: 10,
    iterations: 1,
    tokens: { input: 0, output: 0, total: 0 },
    steps: [],
    techniquesUsed: [],
    tacticBreakdown: {},
    methodologies: [],
    toolsUsed: [],
    methodologyBreakdown: {},
  };
}

// =============================================================================
// resolveDefaultAnalyzerModel — provider-aware benchmark-model fallback
// =============================================================================

describe('resolveDefaultAnalyzerModel', () => {
  it('returns DEFAULT_ANALYZER_MODEL for anthropic provider', () => {
    const result = makeRunResult('ollama', 'qwen3:30b');
    expect(resolveDefaultAnalyzerModel('anthropic', result)).toBe(DEFAULT_ANALYZER_MODEL);
  });

  it('returns benchmark model for ollama (always, regardless of provider matching)', () => {
    const result = makeRunResult('ollama', 'qwen3:30b');
    expect(resolveDefaultAnalyzerModel('ollama', result)).toBe('qwen3:30b');
  });

  it('falls back to model field when modelVersion is empty for ollama', () => {
    const result = makeRunResult('ollama', '');
    result.model = 'deepseek-r1:14b';
    expect(resolveDefaultAnalyzerModel('ollama', result)).toBe('deepseek-r1:14b');
  });

  it('returns benchmark model when providers match', () => {
    const result = makeRunResult('openai', 'gpt-4o-mini');
    expect(resolveDefaultAnalyzerModel('openai', result)).toBe('gpt-4o-mini');
  });

  it('filters out non-text models — falls back to preset default', () => {
    expect(resolveDefaultAnalyzerModel('xai', makeRunResult('xai', 'grok-imagine-image'))).toBe('grok-4-0709');
    expect(resolveDefaultAnalyzerModel('openai', makeRunResult('openai', 'text-embedding-3-large'))).toBe('o3');
  });

  it('does not filter vision/text models with "image" in the name', () => {
    const result = makeRunResult('openai', 'gpt-5-image-understanding');
    expect(resolveDefaultAnalyzerModel('openai', result)).toBe('gpt-5-image-understanding');
  });

  it('returns preset default when providers differ', () => {
    const result = makeRunResult('ollama', 'qwen3:30b');
    expect(resolveDefaultAnalyzerModel('openai', result)).toBe('o3');
  });

  it('handles provider aliases', () => {
    expect(resolveDefaultAnalyzerModel('grok', makeRunResult('xai', 'grok-3-latest'))).toBe('grok-3-latest');
    expect(resolveDefaultAnalyzerModel('gemini', makeRunResult('google', 'gemini-2.0-flash'))).toBe('gemini-2.0-flash');
    expect(resolveDefaultAnalyzerModel('claude', makeRunResult('ollama', 'qwen3:30b'))).toBe(DEFAULT_ANALYZER_MODEL);
  });
});

// =============================================================================
// parseAnalysisResponse — malformed LLM output handling
// =============================================================================

describe('parseAnalysisResponse', () => {
  const dummyResult = makeRunResult('anthropic', 'claude-3');

  it('returns parseFailed for empty string', async () => {
    const result = await parseAnalysisResponse('', 'run-1', dummyResult);
    expect(result.parseFailed).toBe(true);
  });

  it('returns parseFailed for truncated JSON', async () => {
    const result = await parseAnalysisResponse('{"attackChain": {"phases": [', 'run-1', dummyResult);
    expect(result.parseFailed).toBe(true);
  });

  it('provides graceful defaults for valid JSON with missing fields', async () => {
    const result = await parseAnalysisResponse('{}', 'run-1', dummyResult);
    expect(result.parseFailed).toBeUndefined();
    expect(result.attackChain.phases).toEqual([]);
    expect(result.narrative.summary).toBe('Analysis unavailable');
    expect(result.behavior.approach).toBe('exploratory');
    expect(result.strategy.overallScore).toBe(0);
  });

  it('preserves overallScore: 0 without triggering fallback', async () => {
    const json = JSON.stringify({
      strategy: { reconQuality: 80, exploitEfficiency: 70, adaptability: 90, overallScore: 0, scoreBreakdown: 'test' },
    });
    const result = await parseAnalysisResponse(json, 'run-1', dummyResult);
    expect(result.strategy.overallScore).toBe(0);
  });

  it('strips markdown code fences', async () => {
    const json = '```json\n{"strategy": {"overallScore": 42}}\n```';
    const result = await parseAnalysisResponse(json, 'run-1', dummyResult);
    expect(result.strategy.overallScore).toBe(42);
  });
});
