import { select, input, password } from '@inquirer/prompts';
import ora from 'ora';
import { resolve as pathResolve } from 'path';
import { colors, status, formatDifficulty, formatCategory, printScoreSummary, printBox } from '../lib/display.js';
import { calculateKSM, calculateEfficacy } from '../lib/scoring.js';
import {
  getApiKey, setApiKey, getConfigValue,
  normalizeProvider, getEffectiveProviderUrl,
  getChallengesDir, getResultsDir,
} from '../lib/config.js';
import { PROVIDERS, fetchAvailableModels } from '../lib/providers.js';
import { runBenchmark, saveRunResult, saveAnalysisResult } from '../lib/runner.js';
import { analyzeRun } from '../lib/analyzer.js';
import { ensureDocker, runPostStartChecks, checkApiKey } from '../lib/env-check.js';
import { printAnalysisSummary } from '../lib/report.js';
import { promptExport } from '../lib/export.js';
import { QuotaExceededError } from '../lib/retry.js';
import { pullAndStartContainers, waitForTarget, cleanup, startFromCompose, stopFromCompose } from '../lib/docker.js';
import { buildContainerSpec } from '../lib/registry.js';
import { loadLocalChallenges, loadRegistryChallenges } from './helpers.js';
import type { ContainerSpec } from '../lib/docker.js';
import type { RegistryChallengeChoice } from './helpers.js';
import type { ChallengeConfig, RunnerConfig } from '../lib/types.js';

const enum Step {
  SOURCE     = 0,
  CHALLENGE  = 1,
  PROVIDER   = 2,
  MODEL      = 3,
  CREDENTIALS = 4,
  ANALYSIS   = 5,
  CONFIRM    = 6,
}

export async function runBenchmarkFlow(): Promise<void> {
  let step: Step = Step.SOURCE;

  // State accumulated across steps
  let source: 'registry' | 'local' = 'registry';
  let challengeConfig!: ChallengeConfig;
  let containerSpec: ContainerSpec | null = null;
  let challengeDir: string | undefined;
  let provider = '';
  let providerName = '';
  let preset: (typeof PROVIDERS)[string] | undefined;
  let model = '';
  let resolvedApiKey: string | undefined;
  let resolvedApiUrl: string | undefined;
  let runAnalysis = true;

  // Cached challenge lists (avoid re-fetching on back navigation)
  let cachedLocalChallenges: ChallengeConfig[] | null = null;
  let cachedRegistryChoices: RegistryChallengeChoice[] | null = null;
  let cachedSource: 'registry' | 'local' | null = null;

  while (step <= Step.CONFIRM) {
    switch (step) {
      // ── Step 0: Challenge source ──────────────────────────────────────
      case Step.SOURCE: {
        const selected = await select({
          message: 'Challenge source',
          choices: [
            { name: 'Online challenges (registry)', value: 'registry' as const },
            { name: 'Local directory', value: 'local' as const },
            { name: colors.gray('← Back'), value: '__back__' as const },
          ],
        });

        if (selected === '__back__') return;

        source = selected;
        // Invalidate challenge cache when source changes
        if (cachedSource !== source) {
          cachedLocalChallenges = null;
          cachedRegistryChoices = null;
          cachedSource = source;
        }
        step = Step.CHALLENGE;
        break;
      }

      // ── Step 1: Select challenge ──────────────────────────────────────
      case Step.CHALLENGE: {
        const isLocal = source === 'local';

        if (isLocal) {
          if (!cachedLocalChallenges) {
            cachedLocalChallenges = loadLocalChallenges();
          }
          const challenges = cachedLocalChallenges;

          if (challenges.length === 0) {
            console.log(colors.yellow(`\n  ${status.warning} No challenges found.`));
            console.log(colors.gray(`  Challenge directory: ${getChallengesDir()}`));
            console.log(colors.gray(`  Download challenges or set the path with: oasis config set challenges-dir <path>\n`));
            step = Step.SOURCE;
            break;
          }

          const selected = await select<ChallengeConfig | '__back__'>({
            message: 'Select challenge',
            choices: [
              ...challenges.map(c => ({
                name: `${c.name} ${formatDifficulty(`[${c.difficulty}]`)} ${formatCategory(c.category)} — ${colors.gray(c.description.slice(0, 60))}`,
                value: c as ChallengeConfig,
              })),
              { name: colors.gray('← Back'), value: '__back__' as const },
            ],
          });

          if (selected === '__back__') { step = Step.SOURCE; break; }

          challengeConfig = selected;
          challengeDir = pathResolve(getChallengesDir(), challengeConfig.id);
          containerSpec = null;
        } else {
          if (!cachedRegistryChoices) {
            const spinnerFetch = ora({
              text: 'Fetching challenges from registry...',
              prefixText: status.info,
            }).start();

            try {
              cachedRegistryChoices = await loadRegistryChallenges();
              spinnerFetch.succeed(`Found ${cachedRegistryChoices.length} challenges`);
            } catch (err) {
              spinnerFetch.fail('Failed to fetch challenge registry');
              console.error(colors.red(`  ${err instanceof Error ? err.message : 'Unknown error'}`));
              console.log(colors.gray(`\n  Returning to source selection.\n`));
              step = Step.SOURCE;
              break;
            }
          }

          const registryChoices = cachedRegistryChoices;

          if (registryChoices.length === 0) {
            console.log(colors.yellow(`\n  ${status.warning} No challenges found in registry.\n`));
            step = Step.SOURCE;
            break;
          }

          const selected = await select<RegistryChallengeChoice | '__back__'>({
            message: 'Select challenge',
            choices: [
              ...registryChoices.map(c => ({
                name: `${c.config.name} ${formatDifficulty(`[${c.config.difficulty}]`)} ${formatCategory(c.config.category)} — ${colors.gray(c.config.description.slice(0, 60))}`,
                value: c as RegistryChallengeChoice,
              })),
              { name: colors.gray('← Back'), value: '__back__' as const },
            ],
          });

          if (selected === '__back__') { step = Step.SOURCE; break; }

          challengeConfig = selected.config;
          containerSpec = buildContainerSpec(selected.entry);
          challengeDir = undefined;
        }

        step = Step.PROVIDER;
        break;
      }

      // ── Step 2: Select provider ───────────────────────────────────────
      case Step.PROVIDER: {
        const providerChoices = Object.entries(PROVIDERS).map(([name, p]) => {
          const hasKey = name === 'ollama' || !!getApiKey(name);
          const dot = hasKey ? colors.green('●') : colors.gray('○');
          return { name: `${dot} ${p.displayName}`, value: name };
        });

        const selected = await select({
          message: 'Select provider',
          choices: [
            ...providerChoices,
            { name: colors.gray('← Back'), value: '__back__' },
          ],
        });

        if (selected === '__back__') { step = Step.CHALLENGE; break; }

        providerName = selected;
        provider = normalizeProvider(providerName);
        preset = PROVIDERS[provider] || PROVIDERS[providerName];
        // Reset downstream state so stale credentials/model don't carry over
        model = '';
        resolvedApiKey = undefined;
        resolvedApiUrl = undefined;
        step = Step.MODEL;
        break;
      }

      // ── Step 3: Select or input model ─────────────────────────────────
      case Step.MODEL: {
        const defaultModel = getConfigValue('defaultModel');

        // Fetch live models from the provider API
        const fetchKey = getApiKey(provider) || getApiKey(providerName);
        const fetchUrl = getEffectiveProviderUrl(provider) || undefined;

        const spinnerModels = ora({ text: `Fetching models from ${providerName}...`, prefixText: status.info }).start();
        const { models: availableModels, live } = await fetchAvailableModels(provider, fetchKey, fetchUrl);
        if (live) {
          spinnerModels.succeed(`Found ${availableModels.length} models from ${providerName}`);
        } else if (availableModels.length > 0) {
          spinnerModels.info(`Showing example models (configure API key for live list)`);
        } else {
          spinnerModels.info(`No model list available — enter model ID manually`);
        }

        if (availableModels.length > 0) {
          const modelChoices = [
            ...availableModels.map(m => ({ name: m, value: m })),
            { name: colors.gray('Custom model ID...'), value: '__custom__' },
            { name: colors.gray('← Back'), value: '__back__' },
          ];

          const selected = await select({
            message: 'Select model',
            choices: modelChoices,
            default: defaultModel && availableModels.includes(defaultModel) ? defaultModel : undefined,
          });

          if (selected === '__back__') { step = Step.PROVIDER; break; }

          if (selected === '__custom__') {
            model = await input({
              message: 'Enter model ID:',
              default: defaultModel || '',
            });
          } else {
            model = selected;
          }
        } else {
          // No models available — show a gate select so the user can go back
          const action = await select({
            message: 'Select model',
            choices: [
              { name: 'Enter model ID...', value: '__input__' },
              { name: colors.gray('← Back'), value: '__back__' },
            ],
          });

          if (action === '__back__') { step = Step.PROVIDER; break; }

          model = await input({
            message: 'Enter model ID:',
            default: defaultModel || '',
          });
        }

        if (!model || model.trim().length === 0) {
          step = Step.PROVIDER;
          break;
        }
        model = model.trim();

        step = Step.CREDENTIALS;
        break;
      }

      // ── Step 4: Resolve API key & URL (conditional) ───────────────────
      case Step.CREDENTIALS: {
        const requiresApiKey = provider !== 'ollama';
        resolvedApiKey = getApiKey(provider);

        if (requiresApiKey && !resolvedApiKey) {
          console.log(colors.yellow(`\n  ${status.warning} No API key configured for ${provider}.`));
          const key = await password({
            message: `Enter API key for ${provider} (leave empty to go back):`,
            mask: '*',
          });

          if (!key || key.trim().length === 0) {
            step = Step.MODEL;
            break;
          }

          resolvedApiKey = key.trim();

          const saveAction = await select({
            message: 'Save this key for future use?',
            choices: [
              { name: 'Yes', value: 'yes' },
              { name: 'No', value: 'no' },
            ],
          });

          if (saveAction === 'yes') {
            setApiKey(provider, resolvedApiKey);
            console.log(colors.green(`  ${status.success} Key saved.`));
          }
        }

        // Resolve API URL
        resolvedApiUrl = getEffectiveProviderUrl(provider);

        if (provider === 'custom' && !resolvedApiUrl) {
          const url = await input({
            message: 'Enter API endpoint URL (leave empty to go back):',
          });
          if (!url || url.trim().length === 0) {
            step = Step.MODEL;
            break;
          }
          resolvedApiUrl = url.trim();
        }

        step = Step.ANALYSIS;
        break;
      }

      // ── Step 5: Analysis toggle ───────────────────────────────────────
      case Step.ANALYSIS: {
        const selected = await select({
          message: 'Run analysis after benchmark?',
          choices: [
            { name: 'Yes', value: 'yes' },
            { name: 'No', value: 'no' },
            { name: colors.gray('← Back'), value: '__back__' },
          ],
        });

        if (selected === '__back__') {
          step = Step.CREDENTIALS;
          break;
        }

        runAnalysis = selected === 'yes';
        step = Step.CONFIRM;
        break;
      }

      // ── Step 6: Summary + confirm ─────────────────────────────────────
      case Step.CONFIRM: {
        const isLocalMode = source === 'local';

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

        const selected = await select({
          message: 'Start benchmark?',
          choices: [
            { name: 'Yes', value: 'yes' },
            { name: 'No', value: 'no' },
            { name: colors.gray('← Back'), value: '__back__' },
          ],
        });

        if (selected === '__back__') { step = Step.ANALYSIS; break; }
        if (selected === 'no') return;

        // Confirmed — break out of the wizard loop
        step = (Step.CONFIRM + 1) as Step;
        break;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Execution phase (unchanged from here onward)
  // ════════════════════════════════════════════════════════════════════════

  const isLocalMode = source === 'local';
  const requiresApiKey = provider !== 'ollama';


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

  // Ensure Docker is running (auto-start on macOS)
  spinnerPreflight.text = 'Checking Docker...';
  const dockerCheck = await ensureDocker(
    (msg) => { spinnerPreflight.text = msg; },
  );

  if (!dockerCheck.ok) {
    spinnerPreflight.fail(dockerCheck.errors[0]);
    for (const hint of dockerCheck.hints) {
      console.log(colors.gray(`  ${hint}`));
    }
    console.log();
    return;
  }

  if (dockerCheck.autoStarted) {
    spinnerPreflight.succeed('Docker Desktop started — pre-flight checks passed');
  } else {
    spinnerPreflight.succeed('Pre-flight checks passed');
  }

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
      pullAndStartContainers(containerSpec!, (msg) => { spinnerContainers.text = msg; });
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
    console.log();
    printBox([
      `  ${colors.gray('Run ID')}   ${colors.yellow(result.id)}`,
      `  ${colors.gray('Saved')}    ${colors.gray(jsonPath)}`,
    ].join('\n'));

    // 11. Run analysis
    let runAnalysisResult: import('../lib/types.js').AnalysisResult | undefined;
    let runKsmScore: number | undefined;
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

          runAnalysisResult = analysis;
          const { jsonPath: analysisPath } = saveAnalysisResult(result.id, analysis, getResultsDir());
          spinnerAnalysis.succeed('Analysis complete');

          printAnalysisSummary(analysis);

          const methodology = analysis.rubricScore?.percentage ?? analysis.strategy.overallScore;
          const efficacy = calculateEfficacy(result.challenge, result.modelVersion, getResultsDir());
          runKsmScore = calculateKSM(methodology, efficacy);
          printScoreSummary({
            ksm: runKsmScore,
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
      console.log();
      printBox(
        `  ${colors.gray('Time')}  ${colors.yellow(result.totalTime.toFixed(1) + 's')}     ${colors.gray('Steps')}  ${colors.yellow(result.iterations.toString())}     ${colors.gray('Tokens')}  ${colors.cyan(result.tokens.total.toLocaleString())}`,
      );
    }

    // 12. Offer export
    await promptExport(result, runAnalysisResult, runKsmScore);

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
