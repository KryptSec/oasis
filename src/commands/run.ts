import { Command, InvalidArgumentError } from 'commander';
import ora from 'ora';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { colors, status, printScoreSummary, printBox } from '../lib/display.js';
import { calculateKSM, calculateEfficacy, getTokenEfficiency } from '../lib/scoring.js';
import { getApiKey, getConfigValue, normalizeProvider, getEffectiveProviderUrl, getChallengesDir, getResultsDir } from '../lib/config.js';
import { runBenchmark, saveRunResult, saveAnalysisResult } from '../lib/runner.js';
import { analyzeRun } from '../lib/analyzer.js';
import { printColorReport, printAnalysisSummary } from '../lib/report.js';
import { ensureDocker, runPreflightChecks, runPostStartChecks, checkApiKey } from '../lib/env-check.js';
import { QuotaExceededError } from '../lib/retry.js';
import { pullAndStartContainers, waitForTarget, cleanup, startFromCompose, stopFromCompose } from '../lib/docker.js';
import { fetchRegistryIndex, fetchChallengeConfig, buildContainerSpec } from '../lib/registry.js';
import type { ContainerSpec } from '../lib/docker.js';
import type { ChallengeConfig, RunnerConfig } from '../lib/types.js';

export const runCommand = new Command('run')
  .description('Run a benchmark against a challenge')
  .requiredOption('-c, --challenge <id>', 'Challenge ID to run')
  .option('-m, --model <model>', 'Model to use (e.g., claude-sonnet-4-5-20250929, gpt-4o)')
  .option('-p, --provider <provider>', 'Provider (anthropic, openai, xai, google, ollama, custom)', 'anthropic')
  .option('-k, --api-key <key>', 'API key (or set via config/environment)')
  .option('-u, --api-url <url>', 'Custom API endpoint URL (for ollama/custom providers)')
  .option('-l, --local <path>', 'Use a local challenge directory (with docker-compose.yml)')
  .option('--analyze', 'Run analysis after completion', true)
  .option('--no-analyze', 'Skip post-run analysis')
  .option('--analyzer-model <model>', 'Model for analysis (default: claude-sonnet-4-5-20250929)')
  .option('--analyzer-key <key>', 'Separate API key for analysis (defaults to anthropic key)')
  .option('--analyzer-provider <provider>', 'Provider for analysis (default: same as benchmark or anthropic)')
  .option('--analyzer-url <url>', 'Custom API endpoint for analyzer')
  .option('--max-iterations <n>', 'Override max iterations', (val: string) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1) {
      throw new InvalidArgumentError('Must be a positive integer.');
    }
    return n;
  })
  .option('--report', 'Print detailed report after run', false)
  .option('--verbose', 'Show detailed output', false)
  .action(async (options) => {
    const { challenge, apiKey, apiUrl, analyze, verbose } = options;
    const localPath = options.local as string | undefined;

    // Use config defaults if not provided
    const provider = normalizeProvider(options.provider || getConfigValue('defaultProvider') || 'anthropic');
    const model = options.model || getConfigValue('defaultModel');

    if (!model) {
      console.error(colors.red(`\n${status.error} No model specified.`));
      console.log(colors.gray(`  Set via --model or configure default:`));
      console.log(colors.gray(`    oasis config set default-model claude-sonnet-4-5-20250929`));
      process.exit(1);
    }

    // Resolve API URL (--api-url flag > config > default)
    const resolvedApiUrl = apiUrl || getEffectiveProviderUrl(provider);

    // Resolve API key
    const resolvedApiKey = apiKey || getApiKey(provider);
    const requiresApiKey = !['ollama'].includes(provider);

    if (requiresApiKey && !resolvedApiKey) {
      console.error(colors.red(`\n${status.error} No API key for ${provider}.`));
      console.log(colors.gray(`  Configure via:`));
      console.log(colors.gray(`    oasis config set api-key ${provider} <your-key>`));
      console.log(colors.gray(`  Or environment variable:`));
      console.log(colors.gray(`    ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GOOGLE_API_KEY`));
      process.exit(1);
    }

    // Validate API key works
    if (requiresApiKey && resolvedApiKey) {
      const keyCheck = await checkApiKey(provider, resolvedApiKey, resolvedApiUrl || undefined);
      if (!keyCheck.ok) {
        console.error(colors.red(`\n${status.error} Pre-flight check failed`));
        for (const err of keyCheck.errors) {
          console.error(colors.red(`  • ${err}`));
        }
        if (keyCheck.hints.length > 0) {
          console.log(colors.gray('\n  Suggestions:'));
          for (const hint of keyCheck.hints) {
            console.log(colors.gray(`    ${hint}`));
          }
        }
        console.log();
        process.exit(1);
      }
    }

    // For custom provider, require URL
    if (provider === 'custom' && !resolvedApiUrl) {
      console.error(colors.red(`\n${status.error} Custom provider requires API URL.`));
      console.log(colors.gray(`  Set via --api-url or configure:`));
      console.log(colors.gray(`    oasis config set api-url custom https://your-endpoint.com/v1`));
      process.exit(1);
    }

    // =========================================================================
    // Resolve challenge: local mode vs registry mode
    // =========================================================================

    let challengeConfig: ChallengeConfig;
    let containerSpec: ContainerSpec | null = null;
    let challengeDir: string | undefined;
    const isLocalMode = !!localPath;

    if (isLocalMode) {
      // Local mode — load from path
      const resolvedPath = pathResolve(localPath!);
      const configPath = pathResolve(resolvedPath, 'challenge.json');

      if (!existsSync(configPath)) {
        console.error(colors.red(`\n${status.error} No challenge.json found in ${resolvedPath}`));
        process.exit(1);
      }

      try {
        challengeConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        console.error(colors.red(`\n${status.error} Failed to parse challenge.json in ${resolvedPath}`));
        process.exit(1);
      }

      challengeDir = resolvedPath;
    } else {
      // Registry mode — fetch from GitHub
      const spinnerRegistry = ora({
        text: 'Fetching challenge registry...',
        prefixText: status.info,
      }).start();

      try {
        const index = await fetchRegistryIndex();
        const entry = index.challenges.find(c => c.id === challenge);

        if (!entry) {
          spinnerRegistry.fail(`Challenge "${challenge}" not found in registry`);
          console.log(colors.gray(`\n  Available challenges:`));
          for (const c of index.challenges) {
            console.log(colors.gray(`    - ${c.id} (${c.name})`));
          }
          console.log();
          process.exit(1);
        }

        challengeConfig = await fetchChallengeConfig(entry);
        containerSpec = buildContainerSpec(entry);
        spinnerRegistry.succeed(`Challenge loaded: ${entry.name}`);
      } catch (err) {
        spinnerRegistry.fail('Failed to fetch challenge registry');
        console.error(colors.red(`  ${err instanceof Error ? err.message : 'Unknown error'}`));
        console.log(colors.gray(`\n  Use --local <path> for local challenges`));
        console.log();
        process.exit(1);
      }
    }

    // =========================================================================
    // Docker: check + start containers
    // =========================================================================

    const spinnerDocker = ora({
      text: 'Checking Docker...',
      prefixText: status.info,
    }).start();

    const dockerCheck = await ensureDocker(
      (msg) => { spinnerDocker.text = msg; },
    );

    if (!dockerCheck.ok) {
      spinnerDocker.fail(dockerCheck.errors[0]);
      for (const hint of dockerCheck.hints) {
        console.log(colors.gray(`  ${hint}`));
      }
      console.log();
      process.exit(1);
    }

    if (dockerCheck.autoStarted) {
      spinnerDocker.succeed('Docker Desktop started');
    } else {
      spinnerDocker.succeed('Docker is running');
    }

    const containerName = challengeConfig!.containerName || `${challenge}-kali-1`;
    const targetUrl = challengeConfig!.target?.startsWith('http')
      ? challengeConfig!.target
      : `http://${challengeConfig!.target}`;

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
      process.exit(1);
    }

    // Post-start checks
    const postCheck = runPostStartChecks(challenge, containerName, targetUrl);
    if (!postCheck.ok) {
      console.error(colors.red(`\n${status.error} Post-start check failed`));
      for (const err of postCheck.errors) {
        console.error(colors.red(`  • ${err}`));
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
      process.exit(1);
    }

    // Resolve analyzer config early (needed for pre-run quota probe)
    const analyzerProvider = analyze
      ? normalizeProvider(options.analyzerProvider || provider)
      : '';
    const analyzerApiKey = analyze
      ? (options.analyzerKey || getApiKey(analyzerProvider) || resolvedApiKey)
      : undefined;
    const analyzerBaseUrl = analyze
      ? (options.analyzerUrl || getEffectiveProviderUrl(analyzerProvider) || undefined)
      : undefined;

    // Display run config card
    console.log();
    const configLines = [
      `  ${colors.gray('Challenge')}   ${colors.white(challengeConfig!.name || challenge)}`,
      `  ${colors.gray('Provider')}    ${colors.cyan(provider)} ${colors.gray(`(${model})`)}`,
      `  ${colors.gray('Mode')}        ${isLocalMode ? colors.yellow('Local') : colors.green('Registry')}`,
    ];
    if (challengeConfig!.limits) {
      configLines.push(`  ${colors.gray('Limits')}      ${colors.yellow(`${challengeConfig!.limits.maxIterations} iterations, ${challengeConfig!.limits.maxTimeSeconds}s max`)}`);
    }
    printBox(configLines.join('\n'));
    console.log();

    // Start benchmark
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
        challenge: challengeConfig!,
        challengeDir,
        maxIterations: options.maxIterations || undefined,
        verbose,
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
      if (challengeConfig!.limits) {
        const iterationsExceeded = challengeConfig!.limits.maxIterations && result.iterations > challengeConfig!.limits.maxIterations;
        const timeExceeded = challengeConfig!.limits.maxTimeSeconds && result.totalTime > challengeConfig!.limits.maxTimeSeconds;

        if (iterationsExceeded || timeExceeded) {
          console.log();
          console.log(colors.yellow(`${status.warning} Limits exceeded:`));
          if (iterationsExceeded) {
            console.log(colors.yellow(`  Iterations: ${result.iterations} / ${challengeConfig!.limits.maxIterations} max`));
          }
          if (timeExceeded) {
            console.log(colors.yellow(`  Time: ${result.totalTime.toFixed(1)}s / ${challengeConfig!.limits.maxTimeSeconds}s max`));
          }
        }
      }

      // Save results
      const { jsonPath } = saveRunResult(result, getResultsDir());
      console.log();
      printBox([
        `  ${colors.gray('Run ID')}   ${colors.yellow(result.id)}`,
        `  ${colors.gray('Saved')}    ${colors.gray(jsonPath)}`,
      ].join('\n'));

      // Print detailed report if requested
      if (options.report) {
        printColorReport(result);
      }

      // Run analysis
      if (analyze) {
        if (!analyzerApiKey && analyzerProvider !== 'ollama') {
          console.log();
          console.log(colors.yellow(`${status.warning} Analysis requires an API key for ${analyzerProvider}.`));
          console.log(colors.gray(`  Configure via: oasis config set api-key ${analyzerProvider} <your-key>`));
          console.log(colors.gray(`  To skip analysis: oasis run --no-analyze ...`));
          return;
        }

        const spinnerAnalysis = ora({
          text: 'Running analysis...',
          prefixText: status.info,
        }).start();

        try {
          const analysis = await analyzeRun(result, {
            apiKey: analyzerApiKey,
            analyzerModel: options.analyzerModel,
            provider: analyzerProvider,
            baseUrl: analyzerBaseUrl,
            challengeTarget: challengeConfig!.target,
            challengeConfig: challengeConfig!,
          });

          const { jsonPath: analysisPath } = saveAnalysisResult(result.id, analysis, getResultsDir());
          spinnerAnalysis.succeed('Analysis complete');

          // Print analysis summary
          printAnalysisSummary(analysis);

          // Print score summary
          const methodology = analysis.rubricScore?.percentage ?? analysis.strategy.overallScore;
          const efficacy = calculateEfficacy(result.challenge, result.modelVersion, getResultsDir());
          printScoreSummary({
            ksm: calculateKSM(methodology, efficacy, getTokenEfficiency(result)),
            efficacy,
            efficiency: analysis.rubricScore?.percentage ?? analysis.strategy.exploitEfficiency ?? 0,
            time: result.totalTime,
          });

          console.log(colors.gray(`Analysis saved to: ${analysisPath}`));
        } catch (analysisError) {
          if (analysisError instanceof QuotaExceededError) {
            spinnerAnalysis.fail('Analysis failed — API quota or rate limit reached');
            console.log();
            console.log(colors.gray(`  Your benchmark results are saved (run ${result.id}).`));
            console.log(colors.gray(`  Retry analysis anytime without re-running the benchmark.`));
            console.log();
            console.log(colors.gray(`  Next steps:`));
            console.log(colors.gray(`    - Retry with another provider:  oasis analyze ${result.id} -p <provider>`));
            console.log(colors.gray(`    - Retry later:                  oasis analyze ${result.id}`));
          } else {
            spinnerAnalysis.fail('Analysis failed');
            console.error(colors.red(`  ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}`));
            console.log(colors.gray(`  Retry later with: oasis analyze ${result.id}`));
          }
        }
      } else {
        // No analysis, just print basic stats
        console.log();
        printBox(
          `  ${colors.gray('Time')}  ${colors.yellow(result.totalTime.toFixed(1) + 's')}     ${colors.gray('Steps')}  ${colors.yellow(result.iterations.toString())}     ${colors.gray('Tokens')}  ${colors.cyan(result.tokens.total.toLocaleString())}`,
        );
      }

      console.log();
      console.log(colors.gray(`  Export: oasis report ${result.id} -f [json|md|html|share] [--clipboard]`));
      console.log();

    } catch (error) {
      spinnerRun.fail('Benchmark failed');
      console.error(colors.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      // Cleanup containers
      if (!isLocalMode && containerSpec) {
        cleanup(containerSpec);
      } else if (isLocalMode && challengeDir) {
        try { stopFromCompose(challengeDir); } catch { /* ignore */ }
      }
    }
  });
