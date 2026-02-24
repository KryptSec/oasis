// OASIS Provider Registry
// Built-in provider presets for common LLM APIs

export interface ProviderPreset {
  name: string;
  displayName: string;
  baseUrl: string | null;    // null = uses native SDK (Anthropic)
  envKey: string | null;     // Environment variable for API key
  models: string[];          // Example model IDs
  isOpenAICompatible: boolean;
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: null,  // Uses native Anthropic SDK
    envKey: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-6-20250522', 'claude-sonnet-4-6-20250514', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
    isOpenAICompatible: false,
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    models: ['o3', 'o4-mini', 'gpt-4.1', 'gpt-4o'],
    isOpenAICompatible: true,
  },
  xai: {
    name: 'xai',
    displayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
    models: ['grok-4-0709', 'grok-3-latest', 'grok-3-mini'],
    isOpenAICompatible: true,
  },
  google: {
    name: 'google',
    displayName: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GOOGLE_API_KEY',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    isOpenAICompatible: true,
  },
  ollama: {
    name: 'ollama',
    displayName: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    envKey: null,
    models: ['llama3.3', 'qwen2.5-coder', 'deepseek-r1', 'mistral'],
    isOpenAICompatible: true,
  },
  custom: {
    name: 'custom',
    displayName: 'Custom',
    baseUrl: null,
    envKey: null,
    models: [],
    isOpenAICompatible: true,
  },
};

// Provider aliases (e.g., claude -> anthropic)
const ALIASES: Record<string, string> = {
  claude: 'anthropic',
  grok: 'xai',
  gemini: 'google',
};

export function resolveProvider(name: string): ProviderPreset | null {
  const normalized = name.toLowerCase();
  const resolvedName = ALIASES[normalized] || normalized;
  return PROVIDERS[resolvedName] || null;
}

export function resolveProviderName(name: string): string {
  const normalized = name.toLowerCase();
  return ALIASES[normalized] || normalized;
}

export function isAnthropicProvider(provider: string): boolean {
  const resolved = resolveProviderName(provider);
  return resolved === 'anthropic';
}

/**
 * Fetch available models from a provider's API.
 * Returns model IDs sorted alphabetically, or falls back to hardcoded list on failure.
 */
export async function fetchAvailableModels(
  provider: string,
  apiKey?: string | null,
  baseUrl?: string | null,
): Promise<{ models: string[]; live: boolean }> {
  const resolved = resolveProviderName(provider);
  const preset = PROVIDERS[resolved];
  if (!preset) return { models: [], live: false };

  const fallback = { models: preset.models, live: false };

  // No key and not ollama → can't call API, return hardcoded
  if (!apiKey && resolved !== 'ollama') {
    // Check env var
    const envKey = preset.envKey ? process.env[preset.envKey] : null;
    if (!envKey) return fallback;
    apiKey = envKey;
  }

  try {
    if (resolved === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey: apiKey!,
        ...(baseUrl && { baseURL: baseUrl }),
      });
      const response = await client.models.list({ limit: 100 });
      const ids = response.data
        .map((m: any) => m.id as string)
        .sort();
      return ids.length > 0 ? { models: ids, live: true } : fallback;
    } else {
      // All other providers are OpenAI-compatible
      const { default: OpenAI } = await import('openai');
      const effectiveUrl = baseUrl || preset.baseUrl || undefined;
      const client = new OpenAI({
        apiKey: apiKey || 'ollama',
        baseURL: effectiveUrl,
      });
      const response = await client.models.list();
      const ids: string[] = [];
      for await (const model of response) {
        ids.push(model.id);
      }
      ids.sort();
      return ids.length > 0 ? { models: ids, live: true } : fallback;
    }
  } catch {
    return fallback;
  }
}

