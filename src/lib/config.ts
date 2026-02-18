import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// XDG Base Directory compliant config path
function resolveConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return join(xdgConfig, 'oasis');
  }
  return join(homedir(), '.config', 'oasis');
}

const CONFIG_DIR = resolveConfigDir();
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

export interface OasisConfig {
  defaultProvider?: string;
  defaultModel?: string;
  analyzerModel?: string;
  challengesDir?: string;   // Path to challenges directory (default: ./challenges in cwd)
  resultsDir?: string;      // Path to results directory (default: ./results in cwd)
  apiBaseUrl?: string;
  providerUrls?: Record<string, string>;
}

export interface OasisCredentials {
  apiKeys: Record<string, string>;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function getConfigPath(): string {
  return CONFIG_DIR;
}

// Config (non-sensitive settings)
export function loadConfig(): OasisConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(config: OasisConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o644 });
}

// String-only config keys
export type StringConfigKey = 'defaultProvider' | 'defaultModel' | 'analyzerModel' | 'challengesDir' | 'resultsDir' | 'apiBaseUrl';

// Directory resolution — challenges and results are relative to cwd, not the package
export function getChallengesDir(): string {
  const config = loadConfig();
  if (config.challengesDir) return resolve(config.challengesDir);
  if (process.env.OASIS_CHALLENGES_DIR) return resolve(process.env.OASIS_CHALLENGES_DIR);
  return resolve(process.cwd(), 'challenges');
}

export function getResultsDir(): string {
  const config = loadConfig();
  if (config.resultsDir) return resolve(config.resultsDir);
  if (process.env.OASIS_RESULTS_DIR) return resolve(process.env.OASIS_RESULTS_DIR);
  return resolve(process.cwd(), 'results');
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigValue(key: StringConfigKey): string | undefined {
  const config = loadConfig();
  return config[key];
}

export function setConfigValue(key: StringConfigKey, value: string): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

export function deleteConfigValue(key: StringConfigKey): void {
  const config = loadConfig();
  delete config[key];
  saveConfig(config);
}

// Credentials (sensitive - restricted permissions)
export function loadCredentials(): OasisCredentials {
  ensureConfigDir();
  if (!existsSync(CREDENTIALS_FILE)) {
    return { apiKeys: {} };
  }
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch {
    return { apiKeys: {} };
  }
}

function saveCredentials(credentials: OasisCredentials): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  // Ensure permissions are correct even if file existed
  chmodSync(CREDENTIALS_FILE, 0o600);
}

export function getApiKey(provider: string): string | undefined {
  // Check environment variables first
  const envKey = getApiKeyFromEnv(provider);
  if (envKey) {
    return envKey;
  }
  // Fall back to stored credentials
  const credentials = loadCredentials();
  return credentials.apiKeys[provider.toLowerCase()];
}

export function setApiKey(provider: string, key: string): void {
  const credentials = loadCredentials();
  credentials.apiKeys[provider.toLowerCase()] = key;
  saveCredentials(credentials);
}

export function deleteApiKey(provider: string): void {
  const credentials = loadCredentials();
  delete credentials.apiKeys[provider.toLowerCase()];
  saveCredentials(credentials);
}

export function listApiKeys(): Record<string, string> {
  const credentials = loadCredentials();
  // Return masked keys for display
  const masked: Record<string, string> = {};
  for (const [provider, key] of Object.entries(credentials.apiKeys)) {
    masked[provider] = maskApiKey(key);
  }
  return masked;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function getApiKeyFromEnv(provider: string): string | undefined {
  const envMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    xai: 'XAI_API_KEY',
    grok: 'XAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    gemini: 'GOOGLE_API_KEY',
  };
  const envVar = envMap[provider.toLowerCase()];
  return envVar ? process.env[envVar] : undefined;
}

// Provider normalization
export function normalizeProvider(provider: string): string {
  const aliases: Record<string, string> = {
    claude: 'anthropic',
    grok: 'xai',
    gemini: 'google',
  };
  return aliases[provider.toLowerCase()] || provider.toLowerCase();
}

// Provider URLs (for ollama, custom endpoints)
export function getProviderUrl(provider: string): string | undefined {
  const config = loadConfig();
  return config.providerUrls?.[provider.toLowerCase()];
}

export function setProviderUrl(provider: string, url: string): void {
  const config = loadConfig();
  if (!config.providerUrls) {
    config.providerUrls = {};
  }
  config.providerUrls[provider.toLowerCase()] = url;
  saveConfig(config);
}

export function deleteProviderUrl(provider: string): void {
  const config = loadConfig();
  if (config.providerUrls) {
    delete config.providerUrls[provider.toLowerCase()];
    saveConfig(config);
  }
}

export function listProviderUrls(): Record<string, string> {
  const config = loadConfig();
  return config.providerUrls || {};
}

// Default URLs for providers
const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ollama: 'http://localhost:11434/v1',
};

export function getEffectiveProviderUrl(provider: string): string {
  const normalized = normalizeProvider(provider);
  // Custom URL takes precedence
  const customUrl = getProviderUrl(normalized);
  if (customUrl) {
    return customUrl;
  }
  // Fall back to default
  return DEFAULT_PROVIDER_URLS[normalized] || '';
}
