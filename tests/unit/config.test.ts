import { describe, it, expect } from 'vitest';
import { normalizeProvider, getEffectiveProviderUrl } from '../../src/lib/config.js';

// =============================================================================
// normalizeProvider
// =============================================================================

describe('normalizeProvider', () => {
  it('normalizes "claude" to "anthropic"', () => {
    expect(normalizeProvider('claude')).toBe('anthropic');
  });

  it('normalizes "Claude" to "anthropic" (case insensitive)', () => {
    expect(normalizeProvider('Claude')).toBe('anthropic');
  });

  it('normalizes "grok" to "xai"', () => {
    expect(normalizeProvider('grok')).toBe('xai');
  });

  it('normalizes "gemini" to "google"', () => {
    expect(normalizeProvider('gemini')).toBe('google');
  });

  it('passes through "anthropic" unchanged', () => {
    expect(normalizeProvider('anthropic')).toBe('anthropic');
  });

  it('passes through "openai" unchanged', () => {
    expect(normalizeProvider('openai')).toBe('openai');
  });

  it('passes through "ollama" unchanged', () => {
    expect(normalizeProvider('ollama')).toBe('ollama');
  });

  it('lowercases unknown providers', () => {
    expect(normalizeProvider('CustomProvider')).toBe('customprovider');
  });
});

// =============================================================================
// getEffectiveProviderUrl
// =============================================================================

describe('getEffectiveProviderUrl', () => {
  it('returns anthropic API URL', () => {
    expect(getEffectiveProviderUrl('anthropic')).toBe('https://api.anthropic.com');
  });

  it('returns openai API URL', () => {
    expect(getEffectiveProviderUrl('openai')).toBe('https://api.openai.com/v1');
  });

  it('returns xai API URL', () => {
    expect(getEffectiveProviderUrl('xai')).toBe('https://api.x.ai/v1');
  });

  it('returns google API URL', () => {
    expect(getEffectiveProviderUrl('google')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  it('returns ollama localhost URL', () => {
    expect(getEffectiveProviderUrl('ollama')).toBe('http://localhost:11434/v1');
  });

  it('resolves aliases (claude -> anthropic URL)', () => {
    expect(getEffectiveProviderUrl('claude')).toBe('https://api.anthropic.com');
  });

  it('resolves aliases (grok -> xai URL)', () => {
    expect(getEffectiveProviderUrl('grok')).toBe('https://api.x.ai/v1');
  });

  it('resolves aliases (gemini -> google URL)', () => {
    expect(getEffectiveProviderUrl('gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  it('returns empty string for unknown providers', () => {
    expect(getEffectiveProviderUrl('unknown-provider')).toBe('');
  });
});
