import { select, input, password, confirm } from '@inquirer/prompts';
import ora from 'ora';
import { resolve as pathResolve } from 'path';
import { colors, status, formatDifficulty, formatCategory, printScoreSummary } from '../lib/display.js';
import { calculateKSS } from '../lib/scoring.js';
import {
  getApiKey, setApiKey, getConfigValue,
  normalizeProvider, getEffectiveProviderUrl,
  getChallengesDir, getResultsDir,
} from '../lib/config.js';
import { PROVIDERS } from '../lib/providers.js';
import { runBenchmark, saveRunResult, saveAnalysisResult } from '../lib/runner.js';
import { analyzeRun } from '../lib/analyzer.js';
import { checkDockerRunning, runPreflightChecks, runPostStartChecks, checkApiKey } from '../lib/env-check.js';
import { printColorReport, printAnalysisSummary } from '../lib/report.js';
import { QuotaExceededError } from '../lib/retry.js';
import { pullImage, startContainers, waitForTarget, cleanup, startFromCompose, stopFromCompose } from '../lib/docker.js';
import { buildContainerSpec } from '../lib/registry.js';
import { loadLocalChallenges, loadRegistryChallenges } from './helpers.js';
import type { ContainerSpec } from '../lib/docker.js';
import type { RegistryChallengeChoice } from './helpers.js';
import type { RegistryEntry } from '../lib/registry.js';
import type { ChallengeConfig, RunnerConfig } from '../lib/types.js';

export async function runBenchmarkFlow(): Promise<void> {
  // 1. Select challenge source
  const source = await select({
    message: 'Challenge source',
    choices: [
      { name: 'Online challenges (registry)', value: 'registry' as const },
      { name: 'Local directory', value: 'local' as const },
    ],
  });

  let challengeConfig: ChallengeConfig;
  let containerSpec: ContainerSpec | null = null;
  let challengeDir: string | undefined;
  let registryEntry: RegistryEntry | null = null;
  const isLocalMode = source === 'local';

  if (isLocalMode) {
    // Load local challenges
    const challenges = loadLocalChallenges();
    if (challenges.length === 0) {
      console.log(colors.yellow(`\n  ${status.warning} No challenges found.`));
      console.log(colors.gray(`  Challenge directory: ${getChallengesDir()}`));
      console.log(colors.gray(`  Download challenges or set the path with: oasis config set challenges-dir <path>\n`));
      return;
    }

    challengeConfig = await select({
      message: 'Select challenge',
      choices: challenges.map(c => ({
        name: `${c.name} ${formatDifficulty(`[${c.difficulty}]`)} ${formatCategory(c.category)} — ${colors.gray(c.description.slice(0, 60))}`,
        value: c,
      })),
    });

    challengeDir = pathResolve(getChallengesDir(), challengeConfig.id);
  } else {
    // Load registry challenges
    const spinnerFetch = ora({
      text: 'Fetching challenges from registry...',
      prefixText: status.info,
    }).start();

    let registryChoices: RegistryChallengeChoice[];
    try {
      registryChoices = await loadRegistryChallenges();
      spinnerFetch.succeed(`Found ${registryChoices.length} challenges`);
    } catch (err) {
      spinnerFetch.fail('Failed to fetch challenge registry');
      console.error(colors.red(`  ${err instanceof Error ? err.message : 'Unknown error'}`));
      console.log(colors.gray(`\n  Select "Local directory" to use local challenges instead.\n`));
      return;
    }

    if (registryChoices.length === 0) {
      console.log(colors.yellow(`\n  ${status.warning} No challenges found in registry.\n`));
      return;
    }

    const choice = await select({
      message: 'Select challenge',
      choices: registryChoices.map(c => ({
        name: `${c.config.name} ${formatDifficulty(`[${c.config.difficulty}]`)} ${formatCategory(c.config.category)} — ${colors.gray(c.config.description.slice(0, 60))}`,
        value: c,
      })),
    });

    challengeConfig = choice.config;
    registryEntry = choice.entry;
    containerSpec = buildContainerSpec(choice.entry);
  }

  // 2. Select provider
  const providerChoices = Object.entries(PROVIDERS).map(([name, preset]) => {
    const hasKey = name === 'ollama' || !!getApiKey(name);
    const dot = hasKey ? colors.green('●') : colors.gray('○');
    return { name: `${dot} ${preset.displayName}`, value: name };
  });

  const providerName = await select({
    message: 'Select provider',
    choices: providerChoices,
  });

  const provider = normalizeProvider(providerName);
  const preset = PROVIDERS[provider] || PROVIDERS[providerName];

  // 3. Select or input model
  let model: string;
  const defaultModel = getConfigValue('defaultModel');
  const knownModels = preset?.models || [];

  if (knownModels.length > 0) {
    const modelChoices = [
      ...knownModels.map(m => ({ name: m, value: m })),
      { name: 'Custom model ID...', value: '__custom__' },
    ];

    const selected = await select({
      message: 'Select model',
      choices: modelChoices,
      default: defaultModel && knownModels.includes(defaultModel) ? defaultModel : undefined,
    });

    if (selected === '__custom__') {
      model = await input({
        message: 'Enter model ID:',
        default: defaultModel || '',
      });
    } else {
      model = selected;
    }
  } else {
    model = await input({
      message: 'Enter model ID:',
      default: defaultModel || '',
    });
  }

  if (!model || model.trim().length === 0) {
    console.log(colors.yellow(`\n  ${status.warning} No model specified.\n`));
    return;
  }
  model = model.trim();

  // 4. Resolve API key
  let resolvedApiKey = getApiKey(provider);
  const requiresApiKey = provider !== 'ollama';

  if (requiresApiKey && !resolvedApiKey) {
    console.log(colors.yellow(`\n  ${status.warning} No API key configured for ${provider}.`));
    const key = await password({
      message: `Enter API key for ${provider}:`,
      mask: '*',
    });

    if (!key || key.trim().length === 0) {
      console.log(colors.yellow(`  ${status.warning} API key required. Returning to menu.\n`));
      return;
    }

    resolvedApiKey = key.trim();

    const shouldSave = await confirm({
      message: 'Save this key for future use?',
      default: true,
    });

    if (shouldSave) {
      setApiKey(provider, resolvedApiKey);
      console.log(colors.green(`  ${status.success} Key saved.`));
    }
  }

  // Resolve API URL
  let resolvedApiUrl = getEffectiveProviderUrl(provider);

  // For custom provider, prompt for URL if none configured
  if (provider === 'custom' && !resolvedApiUrl) {
    resolvedApiUrl = await input({
      message: 'Enter API endpoint URL:',
    });
    if (!resolvedApiUrl || resolvedApiUrl.trim().length === 0) {
      console.log(colors.yellow(`\n  ${status.warning} Custom provider requires an API URL.\n`));
      return;
    }
    resolvedApiUrl = resolvedApiUrl.trim();
  }

  // 5. Analysis toggle
  const runAnalysis = await confirm({
    message: 'Run analysis after benchmark?',
    default: true,
  });

  // 6. Summary + confirm
  console.log();
  console.log(colors.white.bold('  Benchmark Summary'));
  console.log(colors.gray('  ' + '─'.repeat(40)));
  console.log(`  ${colors.gray('Challenge:')}  ${colors.white(challengeConfig.name)} ${formatDifficulty(`[${challengeConfig.difficulty}]`)}`);
  console.log(`  ${colors.gray('Provider:')}   ${colors.white(provider)} (${model})`);
  console.log(`  ${colors.gray('Mode:')}       ${isLocalMode ? 'Local' : 'Registry'}`);
  console.log(`  ${colors.gray('Analysis:')}   ${runAnalysis ? colors.green('yes') : colors.gray('no')}`);
  if (challengeConfig.limits) {
    console.log(`  ${colors.gray('Limits:')}     ${challengeConfig.limits.maxIterations} iterations, ${challengeConfig.limits.maxTimeSeconds}s max`);
  }
  console.log();

  const proceed = await confirm({
    message: 'Start benchmark?',
    default: true,
  });

  if (!proceed) return;

  // 7. Pre-flight: validate API key
  const spinnerPreflight = ora({
    text: 'Running pre-flight checks...',
    prefixText: status.info,
  }).start();

  if (requiresApiKey && resolvedApiKey) {
    const keyCheck = await checkApiKey(provider, resolvedApiKey, resolvedApiUrl || undefined);
    if (!keyCheck.ok) {
      spinnerPreflight.fail('API key validation failed');
      for (const err of keyCheck.errors) {
        console.log(colors.red(`  ${err}`));
      }
      for (const hint of keyCheck.hints) {
        console.log(colors.gray(`  ${hint}`));
      }
      console.log();
      return;
    }
  }

  // Check Docker is running
  const dockerCheck = checkDockerRunning();
  if (!dockerCheck.ok) {
    spinnerPreflight.fail('Docker is not running');
    for (const err of dockerCheck.errors) {
      console.log(colors.red(`  ${err}`));
    }
    for (const hint of dockerCheck.hints) {
      console.log(colors.gray(`  ${hint}`));
    }
    console.log();
    return;
  }

  spinnerPreflight.succeed('Pre-flight checks passed');

  // 8. Start containers
  const containerName = challengeConfig.containerName || `${challengeConfig.id}-kali-1`;
  const targetUrl = challengeConfig.target?.startsWith('http')
    ? challengeConfig.target
    : `http://${challengeConfig.target}`;

  const spinnerContainers = ora({
    text: 'Starting containers...',
    prefixText: status.info,
  }).start();

  try {
    if (isLocalMode) {
      startFromCompose(challengeDir!);
    } else {
      spinnerContainers.text = `Pulling ${containerSpec!.targetImage}...`;
      pullImage(containerSpec!.targetImage);
      spinnerContainers.text = `Pulling ${containerSpec!.kaliImage}...`;
      pullImage(containerSpec!.kaliImage);
      spinnerContainers.text = 'Starting containers...';
      startContainers(containerSpec!);
    }

    spinnerContainers.text = 'Waiting for target to be ready...';
    waitForTarget(containerName, targetUrl);
    spinnerContainers.succeed('Containers ready');
  } catch (err) {
    spinnerContainers.fail('Failed to start containers');
    console.error(colors.red(`  ${err instanceof Error ? err.message : 'Unknown error'}`));
    // Cleanup on failure
    if (!isLocalMode && containerSpec) {
      cleanup(containerSpec);
    } else if (isLocalMode && challengeDir) {
      try { stopFromCompose(challengeDir); } catch { /* ignore */ }
    }
    console.log();
    return;
  }

  // Post-start checks
  const postCheck = runPostStartChecks(challengeConfig.id, containerName, targetUrl);
  if (!postCheck.ok) {
    console.log(colors.red(`\n  ${status.error} Post-start checks failed:`));
    for (const err of postCheck.errors) {
      console.log(colors.red(`  ${err}`));
    }
    if (postCheck.hints.length > 0) {
      console.log(colors.gray('\n  Suggestions:'));
      for (const hint of postCheck.hints) {
        console.log(colors.gray(`    ${hint}`));
      }
    }
    // Cleanup
    if (!isLocalMode && containerSpec) {
      cleanup(containerSpec);
    } else if (isLocalMode && challengeDir) {
      try { stopFromCompose(challengeDir); } catch { /* ignore */ }
    }
    console.log();
    return;
  }

  // 9. Execute benchmark
  const spinnerRun = ora({
    text: 'Agent starting...',
    prefixText: status.info,
  }).start();

  try {
    const runnerConfig: RunnerConfig = {
      provider,
      modelId: model,
      apiKey: resolvedApiKey,
      baseUrl: resolvedApiUrl || undefined,
      challenge: challengeConfig,
      challengeDir,
      onProgress: (phase: string) => {
        spinnerRun.text = phase;
      },
    };

    const result = await runBenchmark(runnerConfig);

    if (result.success) {
      spinnerRun.succeed(colors.green(`Flag captured: ${result.flag}`));
    } else {
      spinnerRun.fail(colors.yellow('Flag not captured'));
    }

    // Check limits
    if (challengeConfig.limits) {
      const iterationsExceeded = challengeConfig.limits.maxIterations && result.iterations > challengeConfig.limits.maxIterations;
      const timeExceeded = challengeConfig.limits.maxTimeSeconds && result.totalTime > challengeConfig.limits.maxTimeSeconds;
      if (iterationsExceeded || timeExceeded) {
        console.log(colors.yellow(`\n  ${status.warning} Limits exceeded:`));
        if (iterationsExceeded) {
          console.log(colors.yellow(`    Iterations: ${result.iterations} / ${challengeConfig.limits.maxIterations} max`));
        }
        if (timeExceeded) {
          console.log(colors.yellow(`    Time: ${result.totalTime.toFixed(1)}s / ${challengeConfig.limits.maxTimeSeconds}s max`));
        }
      }
    }

    // 10. Save results
    const { jsonPath } = saveRunResult(result, getResultsDir());
    console.log(colors.gray(`\n  Run ID: ${result.id}`));
    console.log(colors.gray(`  Results saved to: ${jsonPath}`));

    // 11. Run analysis
    if (runAnalysis) {
      const analyzerProvider = normalizeProvider(provider);
      const analyzerApiKey = getApiKey(analyzerProvider) || resolvedApiKey;
      const analyzerBaseUrl = getEffectiveProviderUrl(analyzerProvider) || undefined;

      if (!analyzerApiKey && analyzerProvider !== 'ollama') {
        console.log(colors.yellow(`\n  ${status.warning} Analysis requires an API key for ${analyzerProvider}.`));
        console.log(colors.gray(`  Run later with: oasis analyze ${result.id}`));
      } else {
        const spinnerAnalysis = ora({
          text: 'Running analysis...',
          prefixText: status.info,
        }).start();

        try {
          const analysis = await analyzeRun(result, {
            apiKey: analyzerApiKey,
            provider: analyzerProvider,
            baseUrl: analyzerBaseUrl,
            challengeTarget: challengeConfig.target,
            challengeConfig,
          });

          const { jsonPath: analysisPath } = saveAnalysisResult(result.id, analysis, getResultsDir());
          spinnerAnalysis.succeed('Analysis complete');

          printAnalysisSummary(analysis);

          const methodology = analysis.rubricScore?.total ?? analysis.strategy.overallScore;
          const efficacy = result.success ? 100 : 0;
          printScoreSummary({
            kss: calculateKSS(methodology, efficacy),
            efficacy,
            efficiency: analysis.rubricScore?.percentage ?? analysis.strategy.exploitEfficiency ?? 0,
            time: result.totalTime,
          });

          console.log(colors.gray(`  Analysis saved to: ${analysisPath}`));
        } catch (analysisError) {
          if (analysisError instanceof QuotaExceededError) {
            spinnerAnalysis.fail('Analysis failed — API quota or rate limit reached');
            console.log(colors.gray(`\n  Results are saved (run ${result.id}).`));
            console.log(colors.gray(`  Retry later: oasis analyze ${result.id}`));
          } else {
            spinnerAnalysis.fail('Analysis failed');
            console.error(colors.red(`  ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}`));
            console.log(colors.gray(`  Retry later: oasis analyze ${result.id}`));
          }
        }
      }
    } else {
      console.log(colors.gray(`\n  Time: ${result.totalTime.toFixed(1)}s | Steps: ${result.iterations} | Tokens: ${result.tokens.total.toLocaleString()}`));
    }

    console.log();
  } catch (error) {
    spinnerRun.fail('Benchmark failed');
    console.error(colors.red(`\n  ${error instanceof Error ? error.message : 'Unknown error'}\n`));
  } finally {
    // Cleanup containers
    if (!isLocalMode && containerSpec) {
      cleanup(containerSpec);
    } else if (isLocalMode && challengeDir) {
      try { stopFromCompose(challengeDir); } catch { /* ignore */ }
    }
  }
}
