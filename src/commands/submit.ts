import { Command } from 'commander';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import ora from 'ora';
import { colors, status, printHeader } from '../lib/display.js';
import { getApiKey, getResultsDir } from '../lib/config.js';

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
  if (!existsSync(getResultsDir())) {
    return null;
  }

  // Direct match
  const directPath = pathResolve(getResultsDir(), `${runId}.json`);
  if (existsSync(directPath)) {
    return directPath;
  }

  // Partial match (run IDs can be truncated)
  const files = readdirSync(getResultsDir())
    .filter(f => f.endsWith('.json') && !f.includes('.analysis.'));

  for (const file of files) {
    if (file.startsWith(runId)) {
      return pathResolve(getResultsDir(), file);
    }
  }

  return null;
}

// List recent runs
function listRecentRuns(limit = 10): void {
  if (!existsSync(getResultsDir())) {
    console.log(colors.gray('  No runs found. Run a benchmark first with:'));
    console.log(colors.gray('    oasis run -c gatekeeper -m <model>'));
    return;
  }

  const files = readdirSync(getResultsDir())
    .filter(f => f.endsWith('.json') && !f.includes('.analysis.'))
    .slice(0, limit * 2); // Read more in case some are invalid

  if (files.length === 0) {
    console.log(colors.gray('  No runs found.'));
    return;
  }

  const runs: Array<{ id: string; model: string; challenge: string; success: boolean; time: string }> = [];

  for (const file of files) {
    try {
      const content = readFileSync(pathResolve(getResultsDir(), file), 'utf-8');
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
  .description('Submit a verified run to the OASIS leaderboard')
  .argument('<run-id>', 'Verified run ID to submit')
  .option('--api-url <url>', 'Custom API endpoint URL')
  .option('--dry-run', 'Show what would be submitted without actually submitting', false)
  .action(async (runId: string, options) => {
    // Validate run ID format
    if (!runId || runId.length < 8) {
      console.error(colors.red(`\n${status.error} Invalid run ID format`));
      console.log(colors.gray('  Run ID should be the UUID from a verified run'));
      console.log(colors.gray('  Example: oasis submit a1b2c3d4-e5f6-7890-abcd-ef1234567890'));
      process.exit(1);
    }

    // Get CLI token (required for authenticated submission)
    const cliToken = getApiKey('oasis') || process.env.OASIS_CLI_TOKEN;
    if (!cliToken) {
      console.error(colors.red(`\n${status.error} Authentication required`));
      console.log(colors.gray('  Please log in first:'));
      console.log(colors.gray('    oasis login'));
      process.exit(1);
    }

    // Get API URL
    const apiUrl = options.apiUrl || process.env.OASIS_API_URL || DEFAULT_API_URL;

    // Prepare submission data (new simplified format)
    const submissionData = {
      runId,
      source: 'cli' as const,
    };

    // Show what we're submitting
    console.log();
    printHeader('Submit to OASIS Leaderboard');

    console.log(colors.white('Submitting verified run:'));
    console.log(`  ${colors.gray('Run ID:')} ${colors.cyan(runId)}`);
    console.log();

    // Dry run mode
    if (options.dryRun) {
      console.log(colors.yellow(`${status.warning} Dry run - not actually submitting`));
      console.log(colors.gray('Remove --dry-run to submit for real.'));
      return;
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
        'X-API-Key': cliToken,  // Use CLI token for authentication
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(submissionData),
      });

      const responseData = await response.json() as SubmitResponse;

      if (!response.ok) {
        spinner.fail('Submission failed');
        console.error(colors.red(`  ${responseData.error || 'Unknown error'}`));

        // Provide helpful error messages
        if (responseData.error?.includes('verified')) {
          console.log();
          console.log(colors.gray('  Only verified runs can be submitted to the leaderboard.'));
          console.log(colors.gray('  Run with --verified flag:'));
          console.log(colors.gray('    oasis run --verified -c <challenge> -m <model>'));
        } else if (responseData.error?.includes('not found')) {
          console.log();
          console.log(colors.gray('  This run ID was not found in your profile.'));
          console.log(colors.gray('  Make sure you ran it with --verified flag.'));
        } else if (responseData.error?.includes('already been submitted')) {
          console.log();
          console.log(colors.gray('  This run has already been submitted.'));
          console.log(colors.gray('  View it at: https://oasis.kryptsec.com/leaderboard'));
        }

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
