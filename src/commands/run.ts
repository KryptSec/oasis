import { Command } from 'commander';
import ora from 'ora';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { colors, status, printScoreSummary } from '../lib/display.js';
import { getApiKey, getConfigValue, normalizeProvider, getEffectiveProviderUrl, getChallengesDir, getResultsDir } from '../lib/config.js';
import { runBenchmark, saveRunResult, saveAnalysisResult } from '../lib/runner.js';
import { analyzeRun } from '../lib/analyzer.js';
import { printColorReport, printAnalysisSummary } from '../lib/report.js';
import { isAnthropicProvider } from '../lib/providers.js';
import { runPreflightChecks, checkApiKey } from '../lib/env-check.js';
import type { ChallengeConfig, RunnerConfig } from '../lib/types.js';

export const runCommand = new Command('run')
  .description('Run a benchmark against a challenge')
  .requiredOption('-c, --challenge <id>', 'Challenge ID to run')
  .option('-m, --model <model>', 'Model to use (e.g., claude-sonnet-4-5-20250929, gpt-4o)')
  .option('-p, --provider <provider>', 'Provider (anthropic, openai, xai, google, ollama, custom)', 'anthropic')
  .option('-k, --api-key <key>', 'API key (or set via config/environment)')
  .option('-u, --api-url <url>', 'Custom API endpoint URL (for ollama/custom providers)')
  .option('--analyze', 'Run analysis after completion', true)
  .option('--no-analyze', 'Skip post-run analysis')
  .option('--analyzer-model <model>', 'Model for analysis (default: claude-sonnet-4-5-20250929)')
  .option('--analyzer-key <key>', 'Separate API key for analysis (defaults to anthropic key)')
  .option('--max-iterations <n>', 'Override max iterations', parseInt)
  .option('--report', 'Print detailed report after run', false)
  .option('--verbose', 'Show detailed output', false)
  .action(async (options) => {
    const { challenge, apiKey, apiUrl, analyze, verbose } = options;

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

    // Validate challenge exists
    const challengesDir = getChallengesDir();
    const challengePath = pathResolve(challengesDir, challenge);
    if (!existsSync(challengePath)) {
      console.error(colors.red(`\n${status.error} Challenge not found: ${challenge}`));
      console.log(colors.gray(`  Available challenges:`));
      listChallenges(challengesDir);
      process.exit(1);
    }

    // Load challenge config
    const challengeConfigPath = pathResolve(challengePath, 'challenge.json');
    let challengeConfig: ChallengeConfig;

    if (existsSync(challengeConfigPath)) {
      try {
        challengeConfig = JSON.parse(readFileSync(challengeConfigPath, 'utf-8'));
      } catch (e) {
        console.error(colors.red(`\n${status.error} Failed to parse challenge.json`));
        process.exit(1);
      }
    } else {
      console.error(colors.red(`\n${status.error} No challenge.json found in ${challengePath}`));
      process.exit(1);
    }

    // Pre-flight: verify Docker and challenge environment
    const containerName = challengeConfig.containerName || `${challenge}-kali-1`;
    const targetUrl = challengeConfig.target?.startsWith('http') ? challengeConfig.target : `http://${challengeConfig.target}`;

    const preflight = runPreflightChecks(challenge, challengePath, containerName, targetUrl);
    if (!preflight.ok) {
      console.error(colors.red(`\n${status.error} Pre-flight check failed`));
      for (const err of preflight.errors) {
        console.error(colors.red(`  • ${err}`));
      }
      if (preflight.hints.length > 0) {
        console.log(colors.gray('\n  Suggestions:'));
        for (const hint of preflight.hints) {
          console.log(colors.gray(`    ${hint}`));
        }
      }
      console.log();
      process.exit(1);
    }

    // Display run info
    console.log();
    console.log(colors.gray(`Challenge: ${challengeConfig.name || challenge}`));
    console.log(colors.gray(`Provider:  ${provider} (${model})`));
    console.log(colors.gray(`Mode:      Local`));
    if (challengeConfig.limits) {
      console.log(colors.gray(`Limits:    ${challengeConfig.limits.maxIterations} iterations, ${challengeConfig.limits.maxTimeSeconds}s max`));
    }
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
        challenge: challengeConfig,
        challengeDir: challengePath,
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
      if (challengeConfig.limits) {
        const iterationsExceeded = challengeConfig.limits.maxIterations && result.iterations > challengeConfig.limits.maxIterations;
        const timeExceeded = challengeConfig.limits.maxTimeSeconds && result.totalTime > challengeConfig.limits.maxTimeSeconds;

        if (iterationsExceeded || timeExceeded) {
          console.log();
          console.log(colors.yellow(`${status.warning} Limits exceeded:`));
          if (iterationsExceeded) {
            console.log(colors.yellow(`  Iterations: ${result.iterations} / ${challengeConfig.limits.maxIterations} max`));
          }
          if (timeExceeded) {
            console.log(colors.yellow(`  Time: ${result.totalTime.toFixed(1)}s / ${challengeConfig.limits.maxTimeSeconds}s max`));
          }
        }
      }

      // Save results
      const { jsonPath } = saveRunResult(result, getResultsDir());
      console.log(colors.gray(`\nRun ID: ${result.id}`));
      console.log(colors.gray(`Results saved to: ${jsonPath}`));

      // Print detailed report if requested
      if (options.report) {
        printColorReport(result);
      }

      // Run analysis
      if (analyze) {
        const analyzerApiKey = options.analyzerKey || getApiKey('anthropic') || resolvedApiKey;

        if (!analyzerApiKey || !isAnthropicProvider('anthropic')) {
          // Need an Anthropic key for analysis
          const hasAnthropicKey = getApiKey('anthropic') || process.env.ANTHROPIC_API_KEY;
          if (!hasAnthropicKey && !isAnthropicProvider(provider)) {
            console.log();
            console.log(colors.yellow(`${status.warning} Analysis requires an Anthropic API key.`));
            console.log(colors.gray(`  Configure via: oasis config set api-key anthropic <your-key>`));
            console.log(colors.gray(`  Or set: ANTHROPIC_API_KEY=<your-key>`));
            console.log(colors.gray(`  To skip analysis: oasis run --no-analyze ...`));
            return;
          }
        }

        const spinnerAnalysis = ora({
          text: 'Running analysis...',
          prefixText: status.info,
        }).start();

        try {
          const analysis = await analyzeRun(result, {
            apiKey: options.analyzerKey || getApiKey('anthropic') || process.env.ANTHROPIC_API_KEY || resolvedApiKey,
            analyzerModel: options.analyzerModel,
            challengeTarget: challengeConfig.target,
            challengeConfig,
          });

          const { jsonPath: analysisPath } = saveAnalysisResult(result.id, analysis, getResultsDir());
          spinnerAnalysis.succeed('Analysis complete');

          // Print analysis summary
          printAnalysisSummary(analysis);

          // Print score summary
          if (analysis.rubricScore) {
            printScoreSummary({
              kss: analysis.rubricScore.total,
              efficacy: result.success ? 100 : 0,
              efficiency: analysis.rubricScore.percentage || 0,
              time: result.totalTime,
            });
          } else {
            printScoreSummary({
              kss: analysis.strategy.overallScore,
              efficacy: result.success ? 100 : 0,
              efficiency: analysis.strategy.exploitEfficiency || 0,
              time: result.totalTime,
            });
          }

          console.log(colors.gray(`Analysis saved to: ${analysisPath}`));
        } catch (analysisError) {
          spinnerAnalysis.fail('Analysis failed');
          console.error(colors.red(`  ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}`));
          console.log(colors.gray(`  Retry later with: oasis analyze ${result.id}`));
        }
      } else {
        // No analysis, just print basic stats
        console.log(colors.gray(`\nTime: ${result.totalTime.toFixed(1)}s | Steps: ${result.iterations} | Tokens: ${result.tokens.total.toLocaleString()}`));
      }

      console.log();

    } catch (error) {
      spinnerRun.fail('Benchmark failed');
      console.error(colors.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

function listChallenges(challengesDir: string): void {
  if (!existsSync(challengesDir)) {
    console.log(colors.gray('    (no challenges found)'));
    return;
  }

  const challenges = readdirSync(challengesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);

  for (const c of challenges) {
    console.log(colors.gray(`    - ${c}`));
  }
}

