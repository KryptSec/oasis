import { select, input, password, confirm } from '@inquirer/prompts';
import { colors, status, printBox } from '../lib/display.js';
import {
  getApiKey, setApiKey, deleteApiKey, listApiKeys,
  getConfigValue, setConfigValue, deleteConfigValue,
  getEffectiveProviderUrl, setProviderUrl, deleteProviderUrl, listProviderUrls,
  normalizeProvider,
} from '../lib/config.js';
import { PROVIDERS, fetchAvailableModels } from '../lib/providers.js';
import { checkApiKey } from '../lib/env-check.js';
import ora from 'ora';

export async function configureKeysFlow(): Promise<void> {
  while (true) {
    const action = await select({
      message: 'API Key Management',
      choices: [
        { name: 'View configured keys', value: 'view' },
        { name: 'Add / update API key', value: 'add' },
        { name: 'Remove API key', value: 'remove' },
        { name: 'Set default provider', value: 'default-provider' },
        { name: 'Set default model', value: 'default-model' },
        { name: 'Configure provider URL', value: 'provider-url' },
        { name: 'Back to main menu', value: 'back' },
      ],
    });

    if (action === 'back') return;

    switch (action) {
      case 'view':
        await viewKeys();
        break;
      case 'add':
        await addKey();
        break;
      case 'remove':
        await removeKey();
        break;
      case 'default-provider':
        await setDefaultProvider();
        break;
      case 'default-model':
        await setDefaultModel();
        break;
      case 'provider-url':
        await configureProviderUrl();
        break;
    }
  }
}

async function viewKeys(): Promise<void> {
  const stored = listApiKeys();
  const providers = Object.keys(PROVIDERS);

  const keyLines: string[] = [];
  for (const name of providers) {
    const preset = PROVIDERS[name];
    if (!preset.envKey && name !== 'ollama') continue;

    const envKey = preset.envKey ? process.env[preset.envKey] : undefined;
    const storedKey = stored[name];

    let indicator: string;
    if (envKey) {
      indicator = colors.green(`${status.success} env (${preset.envKey})`);
    } else if (storedKey) {
      indicator = colors.green(`${status.success} ${storedKey}`);
    } else if (name === 'ollama') {
      indicator = colors.gray('no key needed');
    } else {
      indicator = colors.gray(`${status.pending} not set`);
    }

    keyLines.push(`  ${colors.white(preset.displayName.padEnd(12))} ${indicator}`);
  }

  // Show defaults
  const defaultProvider = getConfigValue('defaultProvider');
  const defaultModel = getConfigValue('defaultModel');
  keyLines.push('');
  keyLines.push(`  ${colors.gray('Default provider:')} ${defaultProvider ? colors.cyan(defaultProvider) : colors.gray('not set')}`);
  keyLines.push(`  ${colors.gray('Default model:')}    ${defaultModel ? colors.cyan(defaultModel) : colors.gray('not set')}`);

  // Show custom URLs
  const urls = listProviderUrls();
  if (Object.keys(urls).length > 0) {
    keyLines.push('');
    for (const [provider, url] of Object.entries(urls)) {
      keyLines.push(`  ${colors.white(provider)}: ${colors.cyan(url)}`);
    }
  }

  console.log();
  printBox(keyLines.join('\n'), { title: 'API Keys' });
  console.log();
}

async function addKey(): Promise<void> {
  const providerChoices = Object.entries(PROVIDERS)
    .filter(([name]) => name !== 'ollama')
    .map(([name, preset]) => {
      const hasKey = !!getApiKey(name);
      const dot = hasKey ? colors.green('●') : colors.gray('○');
      return { name: `${dot} ${preset.displayName}`, value: name };
    });

  const provider = await select({
    message: 'Select provider',
    choices: providerChoices,
  });

  const key = await password({
    message: `Enter API key for ${PROVIDERS[provider].displayName}:`,
    mask: '*',
  });

  if (!key || key.trim().length === 0) {
    console.log(colors.yellow(`\n  ${status.warning} No key entered, skipping.\n`));
    return;
  }

  // Validate the key
  const normalized = normalizeProvider(provider);
  const baseUrl = getEffectiveProviderUrl(normalized) || undefined;

  console.log(colors.gray(`\n  Validating key...`));
  const check = await checkApiKey(normalized, key.trim(), baseUrl);

  if (check.ok) {
    setApiKey(provider, key.trim());
    console.log(colors.green(`  ${status.success} API key saved for ${PROVIDERS[provider].displayName}\n`));
  } else {
    console.log(colors.yellow(`\n  ${status.warning} Validation failed:`));
    for (const err of check.errors) {
      console.log(colors.yellow(`    ${err}`));
    }
    const saveAnyway = await confirm({
      message: 'Save key anyway?',
      default: false,
    });
    if (saveAnyway) {
      setApiKey(provider, key.trim());
      console.log(colors.green(`  ${status.success} API key saved.\n`));
    } else {
      console.log(colors.gray('  Key not saved.\n'));
    }
  }
}

async function removeKey(): Promise<void> {
  const stored = listApiKeys();
  const providers = Object.keys(stored);

  if (providers.length === 0) {
    console.log(colors.gray('\n  No stored API keys to remove.\n'));
    return;
  }

  const provider = await select({
    message: 'Select key to remove',
    choices: providers.map(p => ({
      name: `${p} (${stored[p]})`,
      value: p,
    })),
  });

  const confirmed = await confirm({
    message: `Remove API key for ${provider}?`,
    default: false,
  });

  if (confirmed) {
    deleteApiKey(provider);
    console.log(colors.green(`  ${status.success} API key removed for ${provider}\n`));
  }
}

async function setDefaultProvider(): Promise<void> {
  const current = getConfigValue('defaultProvider');
  const choices = Object.entries(PROVIDERS).map(([name, preset]) => ({
    name: `${preset.displayName}${name === current ? ' (current)' : ''}`,
    value: name,
  }));

  const provider = await select({
    message: 'Select default provider',
    choices,
  });

  setConfigValue('defaultProvider', provider);
  console.log(colors.green(`\n  ${status.success} Default provider set to ${PROVIDERS[provider].displayName}\n`));
}

async function setDefaultModel(): Promise<void> {
  const current = getConfigValue('defaultModel');
  const defaultProvider = getConfigValue('defaultProvider');

  if (!defaultProvider) {
    console.log(colors.gray(`\n  Tip: Set a default provider first for model suggestions.`));
    const model = await input({
      message: `Default model ID${current ? ` (current: ${current})` : ''}:`,
      default: current || '',
    });
    if (model && model.trim().length > 0) {
      setConfigValue('defaultModel', model.trim());
      console.log(colors.green(`\n  ${status.success} Default model set to ${model.trim()}\n`));
    }
    return;
  }

  // Fetch live models from the provider API
  const apiKey = getApiKey(defaultProvider);
  const baseUrl = getEffectiveProviderUrl(defaultProvider) || undefined;

  const spinner = ora({ text: `Fetching models from ${defaultProvider}...`, prefixText: status.info }).start();
  const { models: availableModels, live } = await fetchAvailableModels(defaultProvider, apiKey, baseUrl);
  if (live) {
    spinner.succeed(`Found ${availableModels.length} models from ${defaultProvider}`);
  } else {
    spinner.info(`Showing example models (no API key configured for live fetch)`);
  }

  let model: string;

  if (availableModels.length > 0) {
    const modelChoices = [
      ...availableModels.map(m => ({ name: m, value: m })),
      { name: colors.gray('Custom model ID...'), value: '__custom__' },
    ];

    const selected = await select({
      message: `Default model${current ? ` (current: ${colors.cyan(current)})` : ''}`,
      choices: modelChoices,
      default: current && availableModels.includes(current) ? current : undefined,
    });

    if (selected === '__custom__') {
      model = await input({
        message: 'Enter model ID:',
        default: current || '',
      });
    } else {
      model = selected;
    }
  } else {
    model = await input({
      message: `Default model ID${current ? ` (current: ${current})` : ''}:`,
      default: current || '',
    });
  }

  if (model && model.trim().length > 0) {
    setConfigValue('defaultModel', model.trim());
    console.log(colors.green(`\n  ${status.success} Default model set to ${model.trim()}\n`));
  }
}

async function configureProviderUrl(): Promise<void> {
  const provider = await select({
    message: 'Select provider to configure URL',
    choices: Object.entries(PROVIDERS).map(([name, preset]) => {
      const currentUrl = getEffectiveProviderUrl(name);
      return {
        name: `${preset.displayName} — ${colors.gray(currentUrl || 'no URL')}`,
        value: name,
      };
    }),
  });

  const currentUrl = getEffectiveProviderUrl(provider);
  const url = await input({
    message: `API URL for ${PROVIDERS[provider].displayName}:`,
    default: currentUrl || '',
  });

  if (url && url.trim().length > 0) {
    setProviderUrl(provider, url.trim());
    console.log(colors.green(`\n  ${status.success} URL set for ${PROVIDERS[provider].displayName}\n`));
  } else {
    deleteProviderUrl(provider);
    console.log(colors.gray(`\n  URL reset to default for ${PROVIDERS[provider].displayName}\n`));
  }
}
