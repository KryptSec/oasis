import { describe, it, expect } from 'vitest';
import { normalizeProvider, getEffectiveProviderUrl } from '../../src/lib/config.js';

// =============================================================================
// normalizeProvider
// =============================================================================

describe('normalizeProvider', () => {
  it('normalizes aliases to canonical names', () => {
    expect(normalizeProvider('claude')).toBe('anthropic');
    expect(normalizeProvider('grok')).toBe('xai');
    expect(normalizeProvider('gemini')).toBe('google');
  });

  it('passes through canonical providers unchanged', () => {
    expect(normalizeProvider('anthropic')).toBe('anthropic');
    expect(normalizeProvider('openai')).toBe('openai');
  });

  it('lowercases unknown providers', () => {
    expect(normalizeProvider('CustomProvider')).toBe('customprovider');
  });
});

// =============================================================================
// getEffectiveProviderUrl
// =============================================================================

describe('getEffectiveProviderUrl', () => {
  it('returns correct URLs for known providers', () => {
    expect(getEffectiveProviderUrl('anthropic')).toBe('https://api.anthropic.com');
    expect(getEffectiveProviderUrl('openai')).toBe('https://api.openai.com/v1');
    expect(getEffectiveProviderUrl('xai')).toBe('https://api.x.ai/v1');
    expect(getEffectiveProviderUrl('ollama')).toBe('http://localhost:11434/v1');
  });

  it('resolves aliases to correct URLs', () => {
    expect(getEffectiveProviderUrl('claude')).toBe('https://api.anthropic.com');
    expect(getEffectiveProviderUrl('grok')).toBe('https://api.x.ai/v1');
  });

  it('returns empty string for unknown providers', () => {
    expect(getEffectiveProviderUrl('unknown-provider')).toBe('');
  });
});
