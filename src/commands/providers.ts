import { Command } from 'commander';
import { colors, printHeader, printBox } from '../lib/display.js';
import { getApiKey, getProviderUrl } from '../lib/config.js';

interface ProviderInfo {
  name: string;
  description: string;
  models: string[];
  envVar: string;
  configKey: string;
  urlConfigurable: boolean;
  defaultUrl?: string;
  docsUrl?: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    name: 'anthropic',
    description: 'Claude models from Anthropic',
    models: ['claude-opus-4-6-20250522', 'claude-sonnet-4-6-20250514', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
    envVar: 'ANTHROPIC_API_KEY',
    configKey: 'anthropic',
    urlConfigurable: false,
  },
  {
    name: 'openai',
    description: 'GPT and o1 models from OpenAI',
    models: ['o3', 'o4-mini', 'gpt-4.1', 'gpt-4o'],
    envVar: 'OPENAI_API_KEY',
    configKey: 'openai',
    urlConfigurable: false,
  },
  {
    name: 'xai',
    description: 'Grok models from xAI',
    models: ['grok-4-0709', 'grok-3-latest', 'grok-3-mini'],
    envVar: 'XAI_API_KEY',
    configKey: 'xai',
    urlConfigurable: false,
  },
  {
    name: 'google',
    description: 'Gemini models from Google',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    envVar: 'GOOGLE_API_KEY',
    configKey: 'google',
    urlConfigurable: false,
  },
  {
    name: 'ollama',
    description: 'Local models via Ollama',
    models: ['llama3.3', 'qwen2.5-coder', 'deepseek-r1', 'mistral'],
    envVar: '',
    configKey: 'ollama',
    urlConfigurable: true,
    defaultUrl: 'http://localhost:11434',
    docsUrl: 'https://ollama.ai/library',
  },
  {
    name: 'custom',
    description: 'Any OpenAI-compatible API endpoint',
    models: ['your-model-id'],
    envVar: '',
    configKey: 'custom',
    urlConfigurable: true,
  },
];

export const providersCommand = new Command('providers')
  .description('List supported model providers')
  .option('--json', 'Output as JSON', false)
  .action((options) => {
    if (options.json) {
      console.log(JSON.stringify(PROVIDERS, null, 2));
      return;
    }

    printHeader('Supported Providers');

    for (const provider of PROVIDERS) {
      console.log();

      // Check if configured
      const hasKey = getApiKey(provider.configKey);
      const customUrl = getProviderUrl(provider.configKey);
      const statusIcon = hasKey || (provider.name === 'ollama' && customUrl)
        ? colors.green('●')
        : colors.gray('○');

      // Provider name and description
      console.log(`  ${statusIcon} ${colors.cyan.bold(provider.name)}`);
      console.log(colors.gray(`     ${provider.description}`));

      // Example models
      const modelList = provider.models.slice(0, 3).join(', ');
      if (provider.name === 'ollama') {
        console.log(`     Models: ${colors.white('Any model from Ollama library')}`);
      } else if (provider.name === 'custom') {
        console.log(`     Models: ${colors.white('Any model ID supported by your endpoint')}`);
      } else {
        console.log(`     Models: ${colors.white(modelList)}`);
      }

      // Configuration instructions
      if (provider.envVar) {
        console.log(colors.gray(`     Env: ${provider.envVar}`));
        console.log(colors.gray(`     Config: oasis config set api-key ${provider.configKey} <key>`));
      }

      if (provider.urlConfigurable) {
        const url = customUrl || provider.defaultUrl || '<url>';
        console.log(colors.gray(`     URL: oasis config set api-url ${provider.configKey} ${url}`));
      }

      if (provider.docsUrl) {
        console.log(colors.gray(`     Docs: ${provider.docsUrl}`));
      }
    }

    console.log();
    printBox([
      `${colors.gray('●')} = configured   ${colors.gray('○')} = not configured`,
      '',
      `${colors.white('Usage:')}  ${colors.cyan('oasis run -c <challenge> -m <model> -p <provider>')}`,
      '',
      colors.gray('Any model string is accepted. Use the model ID from your provider.'),
    ].join('\n'));
    console.log();
  });

export function getProviderNames(): string[] {
  return PROVIDERS.map(p => p.name);
}

export function isValidProvider(name: string): boolean {
  return PROVIDERS.some(p => p.name === name.toLowerCase());
}
