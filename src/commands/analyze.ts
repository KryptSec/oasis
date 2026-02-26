import { Command } from 'commander';
import ora from 'ora';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { colors, status } from '../lib/display.js';

import { calculateKSM, calculateEfficacyFromResults, getTokenEfficiency } from '../lib/scoring.js';
import { getApiKey, normalizeProvider, getEffectiveProviderUrl, getChallengesDir, getResultsDir } from '../lib/config.js';
import { resolveAnalysisPath, resolveResultPath, InvalidRunIdError, ResultPathEscapeError } from '../lib/results-path.js';

import { analyzeRun } from '../lib/analyzer.js';
import { saveAnalysisResult } from '../lib/runner.js';
import { printAnalysisSummary } from '../lib/report.js';
import { QuotaExceededError } from '../lib/retry.js';
import type { RunResult, ChallengeConfig } from '../lib/types.js';

export const analyzeCommand = new Command('analyze')
  .description('Run analysis on a completed benchmark run')
  .argument('[run-id]', 'Run ID to analyze')
  .option('--all', 'Analyze all runs that lack analysis')
  .option('--reanalyze', 'Re-analyze even if analysis already exists')
  .option('-c, --challenge <id>', 'Override challenge ID for loading config')
  .option('--model <model>', 'Analyzer model (default: claude-sonnet-4-5-20250929)')
  .option('-k, --api-key <key>', 'API key for analysis')
  .option('-p, --provider <provider>', 'Provider for analysis (default: anthropic)')
  .option('--api-url <url>', 'Custom API endpoint for analyzer')
  .action(async (runId, options) => {
    const analyzerProvider = normalizeProvider(options.provider || 'anthropic');
    const apiKey = options.apiKey || getApiKey(analyzerProvider);

    if (!apiKey && analyzerProvider !== 'ollama') {
      console.error(colors.red(`\n${status.error} Analysis requires an API key for ${analyzerProvider}.`));
      console.log(colors.gray(`  Configure via:`));
      console.log(colors.gray(`    oasis config set api-key ${analyzerProvider} <your-key>`));
      process.exit(1);
    }

    if (!existsSync(getResultsDir())) {
      console.error(colors.red(`\n${status.error} No results directory found.`));
      console.log(colors.gray(`  Run a benchmark first: oasis run -c <challenge> -m <model>`));
      process.exit(1);
    }

    // Collect run IDs to analyze
    let runIds: string[] = [];

    if (options.all) {
      const files = readdirSync(getResultsDir())
        .filter(f => f.endsWith('.json') && !f.includes('.analysis.'));

      for (const file of files) {
        const id = file.replace('.json', '');
        let analysisPath: string;
        try {
          analysisPath = resolveAnalysisPath(id);
        } catch (error) {
          if (error instanceof InvalidRunIdError || error instanceof ResultPathEscapeError) {
            continue;
          }
          throw error;
        }
        if (options.reanalyze || !existsSync(analysisPath)) {
          runIds.push(id);
        }
      }

      if (runIds.length === 0) {
        console.log(colors.gray('\nAll runs already have analysis. Use --reanalyze to force.'));
        return;
      }

      console.log(colors.gray(`\nFound ${runIds.length} run(s) to analyze.\n`));
    } else if (runId) {
      runIds = [runId];
    } else {
      // Find most recent run
      const files = readdirSync(getResultsDir())
        .filter(f => f.endsWith('.json') && !f.includes('.analysis.'))
        .map(f => ({
          name: f.replace('.json', ''),
          time: statSync(pathResolve(getResultsDir(), f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      if (files.length === 0) {
        console.error(colors.red(`\n${status.error} No runs found.`));
        process.exit(1);
      }

      runIds = [files[0].name];
      console.log(colors.gray(`\nAnalyzing most recent run: ${runIds[0]}\n`));
    }

    const challengesDir = getChallengesDir();

    // Pre-load all results for multi-run efficacy calculation (avoids O(N*M) disk reads)
    const allResults: RunResult[] = [];
    if (existsSync(getResultsDir())) {
      for (const f of readdirSync(getResultsDir()).filter(f => f.endsWith('.json') && !f.includes('.analysis.'))) {
        try {
          allResults.push(JSON.parse(readFileSync(pathResolve(getResultsDir(), f), 'utf-8')));
        } catch {}
      }
    }

    for (const id of runIds) {
      let resultPath: string;
      try {
        resultPath = resolveResultPath(id);
      } catch (error) {
        if (error instanceof InvalidRunIdError || error instanceof ResultPathEscapeError) {
          console.error(colors.red(`${status.error} Invalid run ID: ${error.runId}`));
          console.log(colors.gray('  Use only letters, numbers, "_" or "-".'));
          if (runIds.length === 1) {
            process.exit(1);
          }
          continue;
        }
        throw error;
      }

      if (!existsSync(resultPath)) {
        console.error(colors.red(`${status.error} Run not found: ${id}`));
        continue;
      }

      const spinner = ora({
        text: `Analyzing run ${id}...`,
        prefixText: status.info,
      }).start();

      try {
        const result: RunResult = JSON.parse(readFileSync(resultPath, 'utf-8'));

        // Load challenge config if available
        const challengeId = options.challenge || result.challenge;
        let challengeConfig: ChallengeConfig | undefined;
        const challengeConfigPath = pathResolve(challengesDir, challengeId, 'challenge.json');

        if (existsSync(challengeConfigPath)) {
          try {
            challengeConfig = JSON.parse(readFileSync(challengeConfigPath, 'utf-8'));
          } catch {}
        }

        const analysis = await analyzeRun(result, {
          apiKey,
          analyzerModel: options.model,
          provider: analyzerProvider,
          baseUrl: options.apiUrl || getEffectiveProviderUrl(analyzerProvider) || undefined,
          challengeTarget: challengeConfig?.target || `Challenge: ${challengeId}`,
          challengeConfig,
        });

        saveAnalysisResult(id, analysis, getResultsDir());

        if (analysis.parseFailed) {
          spinner.warn(`Analysis failed for ${id} — could not parse LLM response (truncated or malformed JSON)`);
        } else {
          spinner.succeed(`Analysis complete for ${id}`);
        }

        // Print summary for single runs
        if (runIds.length === 1) {
          printAnalysisSummary(analysis);
        } else {
          const methodology = analysis.rubricScore?.percentage ?? analysis.strategy.overallScore;
          const score = calculateKSM(methodology, calculateEfficacyFromResults(result.challenge, result.modelVersion, allResults), getTokenEfficiency(result));
          console.log(colors.gray(`  Score: ${score}/100 | Approach: ${analysis.behavior.approach}`));
        }
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          spinner.fail(`Analysis failed for ${id} — API quota or rate limit reached`);
          console.log();
          console.log(colors.gray(`  Your benchmark results are safe. Retry anytime.`));
          console.log();
          console.log(colors.gray(`  Next steps:`));
          console.log(colors.gray(`    - Retry with another provider:  oasis analyze ${id} -p <provider>`));
          console.log(colors.gray(`    - Retry later:                  oasis analyze ${id}`));
        } else {
          spinner.fail(`Analysis failed for ${id}`);
          console.error(colors.red(`  ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      }
    }

    console.log();
  });
