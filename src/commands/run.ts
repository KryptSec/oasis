import { Command } from 'commander';
import ora from 'ora';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { colors, status, printScoreSummary } from '../lib/display.js';
import { getApiKey, getConfigValue, normalizeProvider, getEffectiveProviderUrl, getChallengesDir, getResultsDir } from '../lib/config.js';
import { runBenchmark, saveRunResult, saveAnalysisResult } from '../lib/runner.js';
import { analyzeRun } from '../lib/analyzer.js';
import { printColorReport, printAnalysisSummary } from '../lib/report.js';
import { resolveProvider, isAnthropicProvider } from '../lib/providers.js';
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
  .option('--verified', 'Run as verified benchmark on Kryptsec servers (requires auth)', false)
  .option('--verbose', 'Show detailed output', false)
  .action(async (options) => {
    const { challenge, apiKey, apiUrl, analyze, verbose, verified } = options;

    // Handle verified flag - run on Kryptsec servers
    if (verified) {
      await runVerifiedBenchmark(options);
      return;
    }

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

    // Display run info
    console.log();
    console.log(colors.gray(`Challenge: ${challengeConfig.name || challenge}`));
    console.log(colors.gray(`Provider:  ${provider} (${model})`));
    console.log(colors.gray(`Mode:      Local (unverified)`));
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

// =============================================================================
// Verified Run (Kryptsec servers)
// =============================================================================

async function runVerifiedBenchmark(options: any): Promise<void> {
  const provider = normalizeProvider(options.provider || getConfigValue('defaultProvider') || 'anthropic');
  const model = options.model || getConfigValue('defaultModel');
  const apiKey = options.apiKey || getApiKey(provider);
  const apiUrl = options.apiUrl || getEffectiveProviderUrl(provider);

  if (!model) {
    console.error(colors.red(`\n${status.error} No model specified.`));
    process.exit(1);
  }

  console.log();
  console.log(colors.cyan.bold('Verified Run Mode'));
  console.log(colors.gray('Running on Kryptsec servers for official leaderboard'));
  console.log();

  const cliToken = getApiKey('oasis') || process.env.OASIS_CLI_TOKEN;
  if (!cliToken) {
    console.error(colors.red(`\n${status.error} Authentication required for verified runs`));
    console.log(colors.gray('  Please log in first:'));
    console.log(colors.gray('    oasis login'));
    process.exit(1);
  }

  const oasisApiUrl = process.env.OASIS_API_URL || 'https://oasis.kryptsec.com';

  try {
    const spinnerSpawn = ora({
      text: 'Spawning verified lab environment...',
      prefixText: status.info,
    }).start();

    const spawnResponse = await fetch(`${oasisApiUrl}/api/oasis/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        challenge_id: options.challenge,
        model_id: model,
        model_provider: provider,
        api_key: apiKey,
        base_url: apiUrl,
        source: 'cli',
      }),
    });

    if (!spawnResponse.ok) {
      const error = await spawnResponse.json() as { error?: string };
      spinnerSpawn.fail('Failed to spawn lab');
      console.error(colors.red(`\n  ${error.error || 'Unknown error'}`));
      process.exit(1);
    }

    const spawnData = await spawnResponse.json() as { deploymentId: string; runId: string };
    spinnerSpawn.succeed('Verified lab spawned');

    const { deploymentId, runId } = spawnData;
    console.log(colors.gray(`  Deployment ID: ${deploymentId}`));
    console.log();

    const spinnerRun = ora({
      text: 'Executing verified benchmark...',
      prefixText: status.info,
    }).start();

    const runResponse = await fetch(`${oasisApiUrl}/api/oasis/${deploymentId}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ai_provider: provider,
        ai_model: model,
        ai_api_key: apiKey,
        ai_base_url: apiUrl,
      }),
    });

    if (!runResponse.ok) {
      const error = await runResponse.json() as { error?: string };
      spinnerRun.fail('Failed to start run');
      console.error(colors.red(`\n  ${error.error || 'Unknown error'}`));
      process.exit(1);
    }

    // Poll for completion
    const challengesDir = getChallengesDir();
    const challengeConfigPath = pathResolve(challengesDir, options.challenge, 'challenge.json');
    let maxTimeSeconds = 600;
    if (existsSync(challengeConfigPath)) {
      try {
        const cc = JSON.parse(readFileSync(challengeConfigPath, 'utf-8'));
        if (cc.limits?.maxTimeSeconds) maxTimeSeconds = cc.limits.maxTimeSeconds;
      } catch {}
    }

    const pollInterval = 5000;
    const maxPollTime = maxTimeSeconds * 1000 + 120000;
    const startPollTime = Date.now();

    while (Date.now() - startPollTime < maxPollTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const transcriptResponse = await fetch(
        `${oasisApiUrl}/api/oasis/${deploymentId}/transcript`,
        { headers: { 'Authorization': `Bearer ${cliToken}` } }
      );

      if (!transcriptResponse.ok) continue;

      const transcriptData = await transcriptResponse.json() as {
        status: string;
        result?: { success?: boolean; flag?: string; totalTime?: number; iterations?: number };
      };

      if (transcriptData.status === 'completed' || transcriptData.status === 'failed') {
        const result = transcriptData.result;
        if (result?.success) {
          spinnerRun.succeed(colors.green(`Flag captured: ${result.flag}`));
        } else {
          spinnerRun.fail(colors.yellow('Flag not captured'));
        }

        console.log();
        console.log(colors.gray(`Time: ${result?.totalTime?.toFixed(1) || 0}s | Iterations: ${result?.iterations || 0}`));
        console.log();
        console.log(colors.gray(`Run ID: ${runId}`));
        console.log(colors.cyan.bold(`Verified run saved to your profile`));
        console.log(colors.gray(`View at: https://oasis.kryptsec.com/oasis/runs`));
        return;
      }
    }

    spinnerRun.fail('Run timed out waiting for completion');
    console.log(colors.gray(`\n  Check status at: https://oasis.kryptsec.com/oasis/runs/${runId}`));

  } catch (error) {
    console.error(colors.red(`\n${status.error} Verified run failed`));
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(colors.red('  Network error - could not reach API'));
    } else {
      console.error(colors.red(`  ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
    process.exit(1);
  }
}
