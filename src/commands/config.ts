import { Command } from 'commander';
import { colors, status } from '../lib/display.js';
import {
  getConfigPath,
  loadConfig,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  getApiKey,
  setApiKey,
  deleteApiKey,
  listApiKeys,
  normalizeProvider,
  setProviderUrl,
  getProviderUrl,
  deleteProviderUrl,
  listProviderUrls,
  type StringConfigKey,
} from '../lib/config.js';
import { getProviderNames } from './providers.js';

export const configCommand = new Command('config')
  .description('Manage OASIS configuration and API keys')
  .addCommand(
    new Command('set')
      .description('Set a configuration value\n\nExamples:\n  oasis config set api-key anthropic sk-ant-xxx\n  oasis config set default-provider anthropic\n  oasis config set default-model claude-sonnet-4-20250514')
      .argument('<key>', 'api-key | api-url | default-provider | default-model')
      .argument('<value>', 'Provider name (for api-key/api-url) or value')
      .argument('[secret]', 'API key or URL (required for api-key/api-url)')
      .action((key: string, value: string, secret?: string) => {
        if (key === 'api-key') {
          if (!secret) {
            console.error(colors.red(`\n${status.error} API key requires provider and key`));
            console.log(colors.gray('  Usage: oasis config set api-key <provider> <key>'));
            console.log(colors.gray('  Example: oasis config set api-key anthropic sk-ant-xxx'));
            process.exit(1);
          }
          const provider = normalizeProvider(value);
          setApiKey(provider, secret);
          console.log(`${status.success} API key for ${colors.cyan(provider)} saved securely`);
        } else if (key === 'default-provider') {
          const provider = normalizeProvider(value);
          const validProviders = getProviderNames();
          if (!validProviders.includes(provider)) {
            console.error(colors.red(`\n${status.error} Invalid provider: ${value}`));
            console.log(colors.gray(`  Valid providers: ${validProviders.join(', ')}`));
            process.exit(1);
          }
          setConfigValue('defaultProvider', provider);
          console.log(`${status.success} Default provider set to ${colors.cyan(provider)}`);
        } else if (key === 'default-model') {
          setConfigValue('defaultModel', value);
          console.log(`${status.success} Default model set to ${colors.cyan(value)}`);
        } else if (key === 'api-url') {
          // api-url requires provider and URL
          if (!secret) {
            console.error(colors.red(`\n${status.error} API URL requires provider and URL`));
            console.log(colors.gray('  Usage: oasis config set api-url <provider> <url>'));
            console.log(colors.gray('  Example: oasis config set api-url ollama http://localhost:11434'));
            process.exit(1);
          }
          const provider = normalizeProvider(value);
          setProviderUrl(provider, secret);
          console.log(`${status.success} API URL for ${colors.cyan(provider)} set to ${colors.cyan(secret)}`);
        } else {
          console.error(colors.red(`\n${status.error} Unknown config key: ${key}`));
          console.log(colors.gray('  Valid keys: api-key, api-url, default-provider, default-model'));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('get')
      .description('Get a configuration value')
      .argument('<key>', 'Configuration key')
      .argument('[provider]', 'For api-key: the provider to get')
      .action((key: string, provider?: string) => {
        if (key === 'api-key') {
          if (!provider) {
            console.error(colors.red(`\n${status.error} Provider required for api-key`));
            console.log(colors.gray('  Usage: oasis config get api-key <provider>'));
            process.exit(1);
          }
          const normalized = normalizeProvider(provider);
          const apiKey = getApiKey(normalized);
          if (apiKey) {
            // Mask the key for display
            const masked = apiKey.length > 8
              ? apiKey.slice(0, 4) + '...' + apiKey.slice(-4)
              : '****';
            console.log(`${colors.cyan(normalized)}: ${masked}`);
          } else {
            console.log(colors.gray(`No API key configured for ${normalized}`));
          }
        } else if (key === 'api-url') {
          if (!provider) {
            console.error(colors.red(`\n${status.error} Provider required for api-url`));
            console.log(colors.gray('  Usage: oasis config get api-url <provider>'));
            process.exit(1);
          }
          const normalized = normalizeProvider(provider);
          const url = getProviderUrl(normalized);
          if (url) {
            console.log(`${colors.cyan(normalized)}: ${url}`);
          } else {
            console.log(colors.gray(`No custom URL configured for ${normalized}`));
          }
        } else {
          const keyMap: Record<string, StringConfigKey> = {
            'default-provider': 'defaultProvider',
            'default-model': 'defaultModel',
          };
          const configKey = keyMap[key];
          if (!configKey) {
            console.error(colors.red(`\n${status.error} Unknown config key: ${key}`));
            process.exit(1);
          }
          const value = getConfigValue(configKey);
          if (value) {
            console.log(value);
          } else {
            console.log(colors.gray(`Not set`));
          }
        }
      })
  )
  .addCommand(
    new Command('delete')
      .alias('rm')
      .description('Delete a configuration value')
      .argument('<key>', 'Configuration key')
      .argument('[provider]', 'For api-key: the provider to delete')
      .action((key: string, provider?: string) => {
        if (key === 'api-key') {
          if (!provider) {
            console.error(colors.red(`\n${status.error} Provider required for api-key`));
            process.exit(1);
          }
          const normalized = normalizeProvider(provider);
          deleteApiKey(normalized);
          console.log(`${status.success} API key for ${colors.cyan(normalized)} deleted`);
        } else if (key === 'api-url') {
          if (!provider) {
            console.error(colors.red(`\n${status.error} Provider required for api-url`));
            process.exit(1);
          }
          const normalized = normalizeProvider(provider);
          deleteProviderUrl(normalized);
          console.log(`${status.success} API URL for ${colors.cyan(normalized)} deleted`);
        } else {
          const keyMap: Record<string, StringConfigKey> = {
            'default-provider': 'defaultProvider',
            'default-model': 'defaultModel',
          };
          const configKey = keyMap[key];
          if (!configKey) {
            console.error(colors.red(`\n${status.error} Unknown config key: ${key}`));
            process.exit(1);
          }
          deleteConfigValue(configKey);
          console.log(`${status.success} ${key} deleted`);
        }
      })
  )
  .addCommand(
    new Command('list')
      .alias('ls')
      .description('List all configuration')
      .option('--show-keys', 'Show masked API keys', false)
      .action((options) => {
        const config = loadConfig();
        const configPath = getConfigPath();

        console.log(colors.purple.bold('\nOASIS Configuration'));
        console.log(colors.gray('─'.repeat(40)));
        console.log(colors.gray(`Config path: ${configPath}\n`));

        // Settings
        console.log(colors.white.bold('Settings:'));
        if (config.defaultProvider) {
          console.log(`  Default provider: ${colors.cyan(config.defaultProvider)}`);
        }
        if (config.defaultModel) {
          console.log(`  Default model: ${colors.cyan(config.defaultModel)}`);
        }
        if (!config.defaultProvider && !config.defaultModel) {
          console.log(colors.gray('  (none configured)'));
        }

        // Provider URLs
        console.log(colors.white.bold('\nProvider URLs:'));
        const urls = listProviderUrls();
        const urlProviders = Object.keys(urls);
        if (urlProviders.length === 0) {
          console.log(colors.gray('  (none configured - using defaults)'));
        } else {
          for (const provider of urlProviders) {
            console.log(`  ${provider}: ${colors.cyan(urls[provider])}`);
          }
        }

        // API Keys
        console.log(colors.white.bold('\nAPI Keys:'));
        if (options.showKeys) {
          const keys = listApiKeys();
          const providers = Object.keys(keys);
          if (providers.length === 0) {
            console.log(colors.gray('  (none configured)'));
          } else {
            for (const provider of providers) {
              console.log(`  ${provider}: ${colors.green(keys[provider])}`);
            }
          }
        } else {
          const keys = listApiKeys();
          const providers = Object.keys(keys);
          if (providers.length === 0) {
            console.log(colors.gray('  (none configured)'));
          } else {
            console.log(`  Configured: ${providers.map(p => colors.cyan(p)).join(', ')}`);
            console.log(colors.gray('  Use --show-keys to display masked keys'));
          }
        }

        // Environment variables
        console.log(colors.white.bold('\nEnvironment Variables:'));
        const envVarMap: Record<string, string | undefined> = {
          'ANTHROPIC_API_KEY': process.env.ANTHROPIC_API_KEY,
          'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
          'XAI_API_KEY': process.env.XAI_API_KEY,
          'GOOGLE_API_KEY': process.env.GOOGLE_API_KEY,
        };
        let hasEnv = false;
        for (const [name, value] of Object.entries(envVarMap)) {
          if (value) {
            console.log(`  ${name}: ${colors.green('set')}`);
            hasEnv = true;
          }
        }
        if (!hasEnv) {
          console.log(colors.gray('  (none set)'));
        }

        // Check if default provider has an API key
        const keys = listApiKeys();
        if (config.defaultProvider) {
          const providerEnvMap: Record<string, string> = {
            'anthropic': 'ANTHROPIC_API_KEY',
            'openai': 'OPENAI_API_KEY',
            'xai': 'XAI_API_KEY',
            'google': 'GOOGLE_API_KEY',
          };
          const envVar = providerEnvMap[config.defaultProvider];
          const hasConfigKey = keys[config.defaultProvider];
          const hasEnvKey = envVar && envVarMap[envVar];

          if (!hasConfigKey && !hasEnvKey && config.defaultProvider !== 'ollama') {
            console.log(colors.yellow(`\n⚠ Warning: No API key for default provider "${config.defaultProvider}"`));
            console.log(colors.gray(`  Run: oasis config set api-key ${config.defaultProvider} <your-key>`));
          }
        }

        console.log();
      })
  )
  .addCommand(
    new Command('path')
      .description('Show the configuration directory path')
      .action(() => {
        console.log(getConfigPath());
      })
  );
