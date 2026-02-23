import { Command } from 'commander';
import { colors, printHeader } from '../lib/display.js';
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
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    envVar: 'ANTHROPIC_API_KEY',
    configKey: 'anthropic',
    urlConfigurable: false,
  },
  {
    name: 'openai',
    description: 'GPT and o1 models from OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
    envVar: 'OPENAI_API_KEY',
    configKey: 'openai',
    urlConfigurable: false,
  },
  {
    name: 'xai',
    description: 'Grok models from xAI',
    models: ['grok-3-latest', 'grok-4-0709', 'grok-2-1212'],
    envVar: 'XAI_API_KEY',
    configKey: 'xai',
    urlConfigurable: false,
  },
  {
    name: 'google',
    description: 'Gemini models from Google',
    models: ['gemini-3-flash-preview', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    envVar: 'GOOGLE_API_KEY',
    configKey: 'google',
    urlConfigurable: false,
  },
  {
    name: 'ollama',
    description: 'Local models via Ollama',
    models: ['llama3.2', 'codellama', 'mistral', 'mixtral'],
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
    console.log(colors.gray('─'.repeat(50)));
    console.log(colors.gray('  ● = configured   ○ = not configured'));
    console.log();
    console.log(colors.white('  Usage:'));
    console.log(colors.gray('    oasis run -c <challenge> -m <model> -p <provider>'));
    console.log();
    console.log(colors.gray('  Any model string is accepted. Use the model ID from your provider.'));
    console.log();
  });

export function getProviderNames(): string[] {
  return PROVIDERS.map(p => p.name);
}

export function isValidProvider(name: string): boolean {
  return PROVIDERS.some(p => p.name === name.toLowerCase());
}
