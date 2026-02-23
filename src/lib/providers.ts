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
    models: ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    isOpenAICompatible: false,
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
    isOpenAICompatible: true,
  },
  xai: {
    name: 'xai',
    displayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
    models: ['grok-3-latest', 'grok-4-0709', 'grok-2-1212'],
    isOpenAICompatible: true,
  },
  google: {
    name: 'google',
    displayName: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GOOGLE_API_KEY',
    models: ['gemini-3-flash-preview', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    isOpenAICompatible: true,
  },
  ollama: {
    name: 'ollama',
    displayName: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    envKey: null,
    models: ['llama3.2', 'codellama', 'mistral', 'deepseek-coder'],
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

