import { Command } from 'commander';
import { resolve as pathResolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync } from 'fs';
import ora from 'ora';
import { colors, status, printHeader } from '../lib/display.js';
import { getApiKey } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the results directory
const RESULTS_DIR = pathResolve(__dirname, '../../../results');

// Default API endpoint
const DEFAULT_API_URL = 'https://oasis.kryptsec.com/api/oasis/submit';

interface ResultFile {
  id: string;
  model: string;
  modelVersion: string;
  challenge: string;
  startTime: string;
  endTime: string;
  success: boolean;
  flag: string | null;
  totalTime: number;
  iterations: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  steps?: object[];
  methodologies?: string[];
  toolsUsed?: string[];
}

interface SubmitResponse {
  submissionId: string;
  message: string;
  error?: string;
}

// Find result file by run ID
function findResultFile(runId: string): string | null {
  if (!existsSync(RESULTS_DIR)) {
    return null;
  }

  // Direct match
  const directPath = pathResolve(RESULTS_DIR, `${runId}.json`);
  if (existsSync(directPath)) {
    return directPath;
  }

  // Partial match (run IDs can be truncated)
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('.analysis.'));

  for (const file of files) {
    if (file.startsWith(runId)) {
      return pathResolve(RESULTS_DIR, file);
    }
  }

  return null;
}

// List recent runs
function listRecentRuns(limit = 10): void {
  if (!existsSync(RESULTS_DIR)) {
    console.log(colors.gray('  No runs found. Run a benchmark first with:'));
    console.log(colors.gray('    oasis run -c gatekeeper -m <model>'));
    return;
  }

  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('.analysis.'))
    .slice(0, limit * 2); // Read more in case some are invalid

  if (files.length === 0) {
    console.log(colors.gray('  No runs found.'));
    return;
  }

  const runs: Array<{ id: string; model: string; challenge: string; success: boolean; time: string }> = [];

  for (const file of files) {
    try {
      const content = readFileSync(pathResolve(RESULTS_DIR, file), 'utf-8');
      const result: ResultFile = JSON.parse(content);
      if (result.endTime) { // Only show completed runs
        runs.push({
          id: result.id,
          model: result.modelVersion || result.model,
          challenge: result.challenge,
          success: result.success,
          time: result.startTime,
        });
      }
    } catch {
      continue;
    }
  }

  // Sort by time descending
  runs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  console.log(colors.white.bold('Recent Runs:'));
  for (const run of runs.slice(0, limit)) {
    const statusIcon = run.success ? colors.green('✓') : colors.red('✗');
    const date = new Date(run.time).toLocaleDateString();
    console.log(`  ${colors.cyan(run.id)} ${statusIcon} ${run.model} on ${run.challenge} (${date})`);
  }
}

// Get provider from model name
function getProviderFromModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic';
  if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
  if (lower.includes('grok') || lower.includes('xai')) return 'xai';
  if (lower.includes('gemini') || lower.includes('google')) return 'google';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('llama') || lower.includes('meta')) return 'meta';
  if (lower.includes('mistral')) return 'mistral';
  return 'unknown';
}

export const submitCommand = new Command('submit')
  .description('Submit benchmark results to the OASIS leaderboard')
  .argument('[run-id]', 'Run ID to submit (or use --file)')
  .option('-f, --file <path>', 'Path to result JSON file')
  .option('-k, --api-key <key>', 'API key for authentication')
  .option('--api-url <url>', 'Custom API endpoint URL')
  .option('--dry-run', 'Show what would be submitted without actually submitting', false)
  .option('--list', 'List recent runs', false)
  .action(async (runId: string | undefined, options) => {
    // List mode
    if (options.list) {
      printHeader('OASIS Runs');
      listRecentRuns();
      console.log();
      console.log(colors.gray('Submit a run with:'));
      console.log(colors.gray('  oasis submit <run-id>'));
      return;
    }

    // Find the result file
    let resultPath: string | null = null;

    if (options.file) {
      resultPath = pathResolve(options.file);
      if (!existsSync(resultPath)) {
        console.error(colors.red(`\n${status.error} File not found: ${options.file}`));
        process.exit(1);
      }
    } else if (runId) {
      resultPath = findResultFile(runId);
      if (!resultPath) {
        console.error(colors.red(`\n${status.error} Run not found: ${runId}`));
        console.log();
        listRecentRuns(5);
        process.exit(1);
      }
    } else {
      console.error(colors.red(`\n${status.error} Please provide a run ID or --file`));
      console.log();
      console.log(colors.white('Usage:'));
      console.log(colors.gray('  oasis submit <run-id>'));
      console.log(colors.gray('  oasis submit --file result.json'));
      console.log(colors.gray('  oasis submit --list'));
      console.log();
      listRecentRuns(5);
      process.exit(1);
    }

    // Load the result file
    let result: ResultFile;
    try {
      const content = readFileSync(resultPath, 'utf-8');
      result = JSON.parse(content);
    } catch (error) {
      console.error(colors.red(`\n${status.error} Failed to parse result file`));
      console.error(colors.gray(`  ${error instanceof Error ? error.message : 'Unknown error'}`));
      process.exit(1);
    }

    // Validate result has required fields
    if (!result.model && !result.modelVersion) {
      console.error(colors.red(`\n${status.error} Result file missing model information`));
      process.exit(1);
    }

    if (!result.challenge) {
      console.error(colors.red(`\n${status.error} Result file missing challenge information`));
      process.exit(1);
    }

    // Check if run is complete
    if (!result.endTime) {
      console.error(colors.red(`\n${status.error} This run is still in progress`));
      console.log(colors.gray('  Wait for the run to complete before submitting.'));
      process.exit(1);
    }

    // Get API key (stored under 'oasis' provider in credentials)
    const apiKey = options.apiKey || process.env.OASIS_API_KEY || getApiKey('oasis');

    // Get API URL
    const apiUrl = options.apiUrl || process.env.OASIS_API_URL || DEFAULT_API_URL;

    // Prepare submission data
    const model = result.modelVersion || result.model;
    const provider = getProviderFromModel(model);

    const submissionData = {
      model,
      provider,
      challenge: result.challenge,
      success: result.success,
      flag: result.flag,
      totalTime: result.totalTime,
      iterations: result.iterations,
      rawResult: result,
      source: 'cli' as const,
      runId: result.id,
    };

    // Show what we're submitting
    console.log();
    printHeader('Submit to OASIS');

    console.log(colors.white('Run Details:'));
    console.log(`  ${colors.gray('Run ID:')}       ${colors.cyan(result.id)}`);
    console.log(`  ${colors.gray('Model:')}        ${colors.white(model)}`);
    console.log(`  ${colors.gray('Provider:')}     ${colors.white(provider)}`);
    console.log(`  ${colors.gray('Challenge:')}    ${colors.white(result.challenge)}`);
    console.log(`  ${colors.gray('Result:')}       ${result.success ? colors.green('SUCCESS') : colors.red('FAILED')}`);
    if (result.flag) {
      console.log(`  ${colors.gray('Flag:')}         ${colors.green(result.flag)}`);
    }
    console.log(`  ${colors.gray('Time:')}         ${colors.cyan(result.totalTime?.toFixed(1) + 's')}`);
    console.log(`  ${colors.gray('Iterations:')}   ${colors.cyan(result.iterations?.toString())}`);
    console.log();

    // Dry run mode
    if (options.dryRun) {
      console.log(colors.yellow(`${status.warning} Dry run - not actually submitting`));
      console.log(colors.gray('Remove --dry-run to submit for real.'));
      return;
    }

    // Check auth
    if (!apiKey) {
      console.log(colors.yellow(`${status.warning} No API key configured - submitting anonymously`));
      console.log(colors.gray('  To submit with your account:'));
      console.log(colors.gray('    oasis config set api-key oasis <your-api-key>'));
      console.log(colors.gray('  Or set OASIS_API_KEY environment variable'));
      console.log();
    }

    // Submit
    const spinner = ora({
      text: 'Submitting to OASIS leaderboard...',
      prefixText: status.info,
    }).start();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'oasis-cli/0.1.0',
      };

      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(submissionData),
      });

      const responseData = await response.json() as SubmitResponse;

      if (!response.ok) {
        spinner.fail('Submission failed');
        console.error(colors.red(`  ${responseData.error || 'Unknown error'}`));
        process.exit(1);
      }

      spinner.succeed('Submitted successfully');

      console.log();
      console.log(`${colors.gray('Submission ID:')} ${colors.cyan(responseData.submissionId)}`);
      console.log(`${colors.gray('View results:')}  ${colors.cyan('https://oasis.kryptsec.com/leaderboard')}`);
      console.log();

    } catch (error) {
      spinner.fail('Submission failed');

      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error(colors.red('  Network error - could not reach API'));
        console.error(colors.gray(`  URL: ${apiUrl}`));
      } else {
        console.error(colors.red(`  ${error instanceof Error ? error.message : 'Unknown error'}`));
      }

      process.exit(1);
    }
  });
