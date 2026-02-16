import { Command } from 'commander';
import ora from 'ora';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { colors, status } from '../lib/display.js';
import { getApiKey, getConfigValue, getChallengesDir, getResultsDir } from '../lib/config.js';
import { analyzeRun } from '../lib/analyzer.js';
import { saveAnalysisResult } from '../lib/runner.js';
import { printAnalysisSummary } from '../lib/report.js';
import type { RunResult, ChallengeConfig } from '../lib/types.js';

export const analyzeCommand = new Command('analyze')
  .description('Run analysis on a completed benchmark run')
  .argument('[run-id]', 'Run ID to analyze')
  .option('--all', 'Analyze all runs that lack analysis')
  .option('--reanalyze', 'Re-analyze even if analysis already exists')
  .option('-c, --challenge <id>', 'Override challenge ID for loading config')
  .option('--model <model>', 'Analyzer model (default: claude-sonnet-4-5-20250929)')
  .option('-k, --api-key <key>', 'Anthropic API key for analysis')
  .action(async (runId, options) => {
    const apiKey = options.apiKey || getApiKey('anthropic') || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error(colors.red(`\n${status.error} Analysis requires an Anthropic API key.`));
      console.log(colors.gray(`  Configure via:`));
      console.log(colors.gray(`    oasis config set api-key anthropic <your-key>`));
      console.log(colors.gray(`  Or set: ANTHROPIC_API_KEY=<your-key>`));
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
        const analysisPath = pathResolve(getResultsDir(), `${id}.analysis.json`);
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

    for (const id of runIds) {
      const resultPath = pathResolve(getResultsDir(), `${id}.json`);

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
          challengeTarget: challengeConfig?.target || `Challenge: ${challengeId}`,
          challengeConfig,
        });

        saveAnalysisResult(id, analysis, getResultsDir());
        spinner.succeed(`Analysis complete for ${id}`);

        // Print summary for single runs
        if (runIds.length === 1) {
          printAnalysisSummary(analysis);
        } else {
          const score = analysis.rubricScore?.total || analysis.strategy.overallScore;
          console.log(colors.gray(`  Score: ${score}/100 | Approach: ${analysis.behavior.approach}`));
        }
      } catch (error) {
        spinner.fail(`Analysis failed for ${id}`);
        console.error(colors.red(`  ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    }

    console.log();
  });
