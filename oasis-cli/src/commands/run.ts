import { Command } from 'commander';
import ora from 'ora';
import { spawn } from 'child_process';
import { resolve as pathResolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { colors, status, printScoreSummary, formatScore } from '../lib/display.js';
import { getApiKey, getConfigValue, normalizeProvider, getEffectiveProviderUrl } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the oasis-agent (relative to CLI package)
const AGENT_DIR = pathResolve(__dirname, '../../../oasis-agent');
const CHALLENGES_DIR = pathResolve(__dirname, '../../../challenges');
const RESULTS_DIR = pathResolve(__dirname, '../../../results');

export const runCommand = new Command('run')
  .description('Run a benchmark against a challenge')
  .requiredOption('-c, --challenge <id>', 'Challenge ID to run')
  .option('-m, --model <model>', 'Model to use (e.g., claude-sonnet-4-20250514, gpt-4o)')
  .option('-p, --provider <provider>', 'Provider (anthropic, openai, xai, google, ollama, custom)', 'anthropic')
  .option('-k, --api-key <key>', 'API key (or set via config/environment)')
  .option('-u, --api-url <url>', 'Custom API endpoint URL (for ollama/custom providers)')
  .option('--analyze', 'Run enterprise analysis after completion', true)
  .option('--submit', 'Automatically submit results to leaderboard after completion', false)
  .option('--verified', 'Run as verified benchmark on Kryptsec servers (requires auth)', false)
  .option('--verbose', 'Show detailed output', false)
  .action(async (options) => {
    const { challenge, apiKey, apiUrl, analyze, verbose, submit, verified } = options;

    // Handle verified flag - not yet implemented
    if (verified) {
      console.log(colors.yellow(`\n${status.warning} Verified runs are not yet available.`));
      console.log(colors.gray('  Verified benchmarks run on Kryptsec servers and are eligible for'));
      console.log(colors.gray('  official leaderboard submissions. Coming soon!'));
      console.log(colors.gray('\n  For now, run without --verified for local benchmarks.'));
      process.exit(0);
    }

    // Use config defaults if not provided
    const provider = normalizeProvider(options.provider || getConfigValue('defaultProvider') || 'anthropic');
    const model = options.model || getConfigValue('defaultModel');

    if (!model) {
      console.error(colors.red(`\n${status.error} No model specified.`));
      console.log(colors.gray(`  Set via --model or configure default:`));
      console.log(colors.gray(`    oasis config set default-model claude-sonnet-4-20250514`));
      process.exit(1);
    }

    // Resolve API URL (--api-url flag > config > default)
    const resolvedApiUrl = apiUrl || getEffectiveProviderUrl(provider);

    // Resolve API key (--api-key flag > config > env)
    // Note: ollama doesn't require an API key
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
    const challengePath = pathResolve(CHALLENGES_DIR, challenge);
    if (!existsSync(challengePath)) {
      console.error(colors.red(`\n${status.error} Challenge not found: ${challenge}`));
      console.log(colors.gray(`  Available challenges:`));
      listChallenges();
      process.exit(1);
    }

    // Load challenge config to get limits
    const challengeConfigPath = pathResolve(challengePath, 'challenge.json');
    let challengeLimits: ChallengeLimits | null = null;

    if (existsSync(challengeConfigPath)) {
      try {
        const challengeConfig = JSON.parse(readFileSync(challengeConfigPath, 'utf-8'));
        if (challengeConfig.limits) {
          challengeLimits = {
            expectedIterations: challengeConfig.limits.expectedIterations,
            maxIterations: challengeConfig.limits.maxIterations,
            maxTimeSeconds: challengeConfig.limits.maxTimeSeconds,
          };
        }
      } catch (e) {
        console.warn(colors.yellow(`\n${status.warning} Could not parse challenge.json limits`));
      }
    }

    // Start the benchmark
    console.log();

    // Display run info
    console.log(colors.gray(`Mode: Local (unverified)`));
    if (challengeLimits) {
      console.log(colors.gray(`Limits: ${challengeLimits.maxIterations} iterations, ${challengeLimits.maxTimeSeconds}s max`));
      if (challengeLimits.expectedIterations) {
        console.log(colors.gray(`Expected: ~${challengeLimits.expectedIterations} iterations`));
      }
    }
    console.log();

    const spinnerEnv = ora({
      text: 'Provisioning challenge environment...',
      prefixText: status.info,
    }).start();

    spinnerEnv.succeed('Challenge environment ready');

    const spinnerAgent = ora({
      text: 'Connecting agent via MCP...',
      prefixText: status.info,
    }).start();

    spinnerAgent.succeed('Agent connected');

    const spinnerRun = ora({
      text: 'Agent executing reconnaissance...',
      prefixText: status.info,
    }).start();

    // Actually run the agent
    try {
      const result = await runAgent({
        challenge,
        model,
        provider,
        apiKey: resolvedApiKey,
        apiUrl: resolvedApiUrl,
        analyze,
        verbose,
        onProgress: (phase: string) => {
          spinnerRun.text = phase;
        },
      });

      // Check if limits were exceeded
      if (challengeLimits) {
        const iterationsExceeded = challengeLimits.maxIterations && result.iterations > challengeLimits.maxIterations;
        const timeExceeded = challengeLimits.maxTimeSeconds && result.totalTime > challengeLimits.maxTimeSeconds;

        if (iterationsExceeded || timeExceeded) {
          result.limitExceeded = true;
          if (iterationsExceeded && timeExceeded) {
            result.limitType = 'both';
          } else if (iterationsExceeded) {
            result.limitType = 'iterations';
          } else {
            result.limitType = 'time';
          }
        }
      }

      if (result.success) {
        spinnerRun.succeed(colors.green(`Flag captured: ${result.flag}`));
      } else {
        spinnerRun.fail(colors.yellow('Flag not captured'));
      }

      // Display limit exceeded warning
      if (result.limitExceeded) {
        console.log();
        console.log(colors.yellow(`${status.warning} Limits exceeded:`));
        if (result.limitType === 'iterations' || result.limitType === 'both') {
          console.log(colors.yellow(`  Iterations: ${result.iterations} / ${challengeLimits?.maxIterations} max`));
        }
        if (result.limitType === 'time' || result.limitType === 'both') {
          console.log(colors.yellow(`  Time: ${result.totalTime.toFixed(1)}s / ${challengeLimits?.maxTimeSeconds}s max`));
        }
        console.log(colors.gray(`  This run would be disqualified from verified leaderboards.`));
      }

      // Print score summary
      if (result.score) {
        printScoreSummary({
          kss: result.score.total,
          efficacy: result.success ? 100 : 0,
          efficiency: result.score.percentage || 0,
          time: result.totalTime,
        });
      } else {
        console.log(colors.gray(`\nTime: ${result.totalTime.toFixed(1)}s | Steps: ${result.iterations}`));
      }

      console.log();

      // Show run ID for reference
      if (result.runId) {
        console.log(colors.gray(`Run ID: ${result.runId}`));
        console.log(colors.gray(`Results saved to: results/${result.runId}.json`));
      }

      // Auto-submit if flag is set
      if (submit && result.runId) {
        console.log();
        await submitResult(result.runId, model, provider, challenge, result);
      }

    } catch (error) {
      spinnerRun.fail('Benchmark failed');
      console.error(colors.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }
  });

function listChallenges(): void {
  if (!existsSync(CHALLENGES_DIR)) {
    console.log(colors.gray('    (no challenges found)'));
    return;
  }

  const challenges = readdirSync(CHALLENGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const c of challenges) {
    console.log(colors.gray(`    - ${c}`));
  }
}

interface ChallengeLimits {
  expectedIterations?: number;
  maxIterations: number;
  maxTimeSeconds: number;
}

interface RunResult {
  runId: string;
  success: boolean;
  flag: string | null;
  totalTime: number;
  iterations: number;
  score?: {
    total: number;
    percentage: number;
  };
  limitExceeded?: boolean;
  limitType?: 'iterations' | 'time' | 'both';
}

async function runAgent(options: {
  challenge: string;
  model: string;
  provider: string;
  apiKey: string;
  apiUrl?: string;
  analyze: boolean;
  verbose: boolean;
  onProgress: (phase: string) => void;
}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Map provider to agent's expected format
    let agentProvider = 'openai-compatible';
    if (options.provider === 'anthropic' || options.provider === 'claude') {
      agentProvider = 'claude';
    } else if (options.provider === 'xai' || options.provider === 'grok') {
      agentProvider = 'grok';
    }

    const args = [
      'tsx',
      'run.ts',
      '--provider', agentProvider,
      '--model-id', options.model,
      '--api-key', options.apiKey || 'none',  // Some providers (like Ollama) don't need a key
    ];

    // Pass base URL for OpenAI-compatible providers (like Ollama)
    if (options.apiUrl && agentProvider === 'openai-compatible') {
      args.push('--base-url', options.apiUrl);
    }

    if (options.analyze) {
      args.push('--analyze');
    }

    const child = spawn('npx', args, {
      cwd: AGENT_DIR,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: agentProvider === 'claude' ? options.apiKey : undefined,
        XAI_API_KEY: agentProvider === 'grok' ? options.apiKey : undefined,
      },
      stdio: options.verbose ? 'inherit' : 'pipe',
    });

    let stdout = '';
    let runId = '';

    if (!options.verbose && child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();

        // Parse progress from agent output
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.includes('Reconnaissance')) {
            options.onProgress('Agent executing reconnaissance...');
          } else if (line.includes('Exploitation')) {
            options.onProgress('Agent attempting exploitation...');
          } else if (line.includes('Privilege')) {
            options.onProgress('Agent escalating privileges...');
          } else if (line.includes('Flag')) {
            options.onProgress('Agent searching for flag...');
          }

          // Capture run ID
          const idMatch = line.match(/Run ID: ([a-f0-9]+)/);
          if (idMatch) {
            runId = idMatch[1];
          }
        }
      });
    }

    child.on('close', (code) => {
      // If we didn't capture run ID from stdout (e.g., verbose mode), find most recent result
      if (!runId && existsSync(RESULTS_DIR)) {
        try {
          const files = readdirSync(RESULTS_DIR)
            .filter((f) => f.endsWith('.json') && !f.includes('.analysis.'))
            .map((f) => ({
              name: f,
              time: statSync(pathResolve(RESULTS_DIR, f)).mtime.getTime(),
            }))
            .sort((a, b) => b.time - a.time);

          if (files.length > 0) {
            // Get run ID from most recent file (created in last 10 seconds)
            const mostRecent = files[0];
            if (Date.now() - mostRecent.time < 10000) {
              runId = mostRecent.name.replace('.json', '');
            }
          }
        } catch {
          // Ignore errors scanning results directory
        }
      }

      // Try to read the result file
      if (runId) {
        const resultPath = pathResolve(RESULTS_DIR, `${runId}.json`);
        const analysisPath = pathResolve(RESULTS_DIR, `${runId}.analysis.json`);

        if (existsSync(resultPath)) {
          try {
            const result = JSON.parse(readFileSync(resultPath, 'utf-8'));
            let score;

            if (existsSync(analysisPath)) {
              const analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
              score = {
                total: analysis.rubricScore?.total || analysis.strategy?.overallScore || 0,
                percentage: analysis.rubricScore?.percentage || 0,
              };
            }

            resolve({
              runId,
              success: result.success,
              flag: result.flag,
              totalTime: result.totalTime,
              iterations: result.iterations,
              score,
            });
            return;
          } catch (e) {
            // Fall through to error handling
          }
        }
      }

      if (code !== 0) {
        reject(new Error(`Agent exited with code ${code}`));
      } else {
        resolve({
          runId: runId || 'unknown',
          success: false,
          flag: null,
          totalTime: 0,
          iterations: 0,
        });
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}


// Default API endpoint for submissions
const DEFAULT_SUBMIT_URL = 'https://oasis.kryptsec.com/api/oasis/submit';

// Auto-submit result to leaderboard
async function submitResult(
  runId: string,
  model: string,
  provider: string,
  challenge: string,
  result: RunResult
): Promise<void> {
  const spinnerSubmit = ora({
    text: 'Submitting to OASIS leaderboard...',
    prefixText: status.info,
  }).start();

  try {
    // Get OASIS API key
    const oasisApiKey = getApiKey('oasis') || process.env.OASIS_API_KEY;
    const apiUrl = process.env.OASIS_API_URL || DEFAULT_SUBMIT_URL;

    // Prepare submission data
    const submissionData = {
      model,
      provider: normalizeProvider(provider),
      challenge,
      success: result.success,
      flag: result.flag,
      totalTime: result.totalTime,
      iterations: result.iterations,
      runId,
      source: 'cli' as const,
      isVerified: false,  // Local runs are never verified
      limitExceeded: result.limitExceeded || false,
      limitType: result.limitType,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'oasis-cli/0.1.0',
    };

    if (oasisApiKey) {
      headers['X-API-Key'] = oasisApiKey;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(submissionData),
    });

    interface SubmitResponse {
      submissionId: string;
      analysisId?: string;
      analysis?: {
        methodologyScore: number;
        mitreTechniqueCount: number;
        owaspCategoryCount: number;
      };
      error?: string;
    }

    const responseData = await response.json() as SubmitResponse;

    if (!response.ok) {
      spinnerSubmit.fail('Submission failed');
      console.error(colors.red(`  ${responseData.error || 'Unknown error'}`));
      return;
    }

    spinnerSubmit.succeed('Submitted to leaderboard');

    // Show analysis results if available
    if (responseData.analysis) {
      console.log();
      console.log(colors.white('Analysis Results:'));
      console.log(`  ${colors.gray('Methodology Score:')} ${colors.cyan(responseData.analysis.methodologyScore.toString())}`);
      console.log(`  ${colors.gray('MITRE Techniques:')}  ${colors.red(responseData.analysis.mitreTechniqueCount.toString())}`);
      console.log(`  ${colors.gray('OWASP Categories:')} ${colors.purple(responseData.analysis.owaspCategoryCount.toString())}`);
    }

    console.log();
    console.log(`${colors.gray('Submission ID:')} ${colors.cyan(responseData.submissionId)}`);
    console.log(`${colors.gray('View results:')}  ${colors.cyan('https://oasis.kryptsec.com/oasis/leaderboard')}`);

  } catch (error) {
    spinnerSubmit.fail('Submission failed');

    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(colors.red('  Network error - could not reach API'));
    } else {
      console.error(colors.red(`  ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }
}
