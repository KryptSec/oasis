#!/usr/bin/env tsx
// Standalone analyzer for existing OASIS benchmark runs
// Usage: npx tsx analyze.ts <runId1> <runId2> ...
// Or: npx tsx analyze.ts --all (analyze all runs without analysis)
// Or: npx tsx analyze.ts --reanalyze-all (re-analyze all runs with new rubric)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { resolve as pathResolve } from 'path';

// Load .env from parent OASIS directory
dotenv.config({ path: pathResolve(process.cwd(), '../.env') });

import { analyzeRun } from './lib/analyzer.js';
import { printAnalysisSummary, generateAnalysisTextReport } from './lib/report.js';
import type { RunResult, ChallengeConfig } from './lib/types.js';

const RESULTS_DIR = resolve(process.cwd(), '../results');
const CHALLENGES_DIR = resolve(process.cwd(), '../challenges');

function loadChallengeConfig(challengeId: string): ChallengeConfig | undefined {
  const challengePath = resolve(CHALLENGES_DIR, challengeId, 'challenge.json');
  if (existsSync(challengePath)) {
    try {
      return JSON.parse(readFileSync(challengePath, 'utf-8'));
    } catch (error) {
      console.log(chalk.yellow(`  Warning: Could not load challenge config for ${challengeId}`));
    }
  }
  return undefined;
}

function saveAnalysis(runId: string, analysis: any): void {
  const analysisPath = resolve(RESULTS_DIR, `${runId}.analysis.json`);
  writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
  console.log(chalk.green(`  Saved: ${analysisPath}`));

  // Also save text report
  const textPath = resolve(RESULTS_DIR, `${runId}.analysis.txt`);
  writeFileSync(textPath, generateAnalysisTextReport(analysis));
  console.log(chalk.green(`  Saved: ${textPath}`));
}

async function analyzeRunById(runId: string, forceReanalyze: boolean = false): Promise<boolean> {
  const runPath = resolve(RESULTS_DIR, `${runId}.json`);
  const analysisPath = resolve(RESULTS_DIR, `${runId}.analysis.json`);

  if (!existsSync(runPath)) {
    console.log(chalk.red(`  Run not found: ${runId}`));
    return false;
  }

  if (existsSync(analysisPath) && !forceReanalyze) {
    console.log(chalk.yellow(`  Already analyzed: ${runId} (skipping, use --reanalyze-all to force)`));
    return true;
  }

  try {
    console.log(chalk.cyan(`\n  Analyzing ${runId}...`));
    const resultJson = readFileSync(runPath, 'utf-8');
    const result: RunResult = JSON.parse(resultJson);

    // Load challenge config for rubric-based scoring
    const challengeConfig = loadChallengeConfig(result.challenge);
    if (challengeConfig?.scoring) {
      console.log(chalk.magenta(`  Using rubric v${challengeConfig.scoring.version} for ${result.challenge}`));
    }

    const analysis = await analyzeRun(result, {
      challengeTarget: challengeConfig?.target,
      challengeConfig,
    });

    saveAnalysis(runId, analysis);
    printAnalysisSummary(analysis);

    // Print rubric score if available
    if (analysis.rubricScore) {
      console.log(chalk.cyan('\n  Rubric Score Breakdown:'));
      console.log(`    Objective: ${analysis.rubricScore.objective.subtotal} pts`);
      console.log(`      - Flag Capture: ${analysis.rubricScore.objective.flagCapture}`);
      console.log(`      - Time Bonus: ${analysis.rubricScore.objective.timeBonus}`);
      console.log(`      - Efficiency Bonus: ${analysis.rubricScore.objective.efficiencyBonus}`);
      console.log(`    Milestones: ${analysis.rubricScore.milestones.points} pts`);
      analysis.rubricScore.milestones.results.forEach(m => {
        const icon = m.achieved ? chalk.green('✓') : chalk.red('✗');
        console.log(`      ${icon} ${m.name}: ${m.achieved ? m.points : 0} pts`);
      });
      console.log(`    Qualitative: ${analysis.rubricScore.qualitative.subtotal} pts`);
      console.log(`    Penalties: ${analysis.rubricScore.penalties.subtotal} pts`);
      console.log(chalk.bold(`    TOTAL: ${analysis.rubricScore.total}/100`));
    }

    return true;
  } catch (error) {
    console.log(chalk.red(`  Error analyzing ${runId}:`, error));
    return false;
  }
}

async function main() {
  console.log(chalk.magenta.bold('\n🔍 OASIS Enterprise Analyzer\n'));

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(chalk.yellow('Usage:'));
    console.log('  npx tsx analyze.ts <runId1> <runId2> ...');
    console.log('  npx tsx analyze.ts --all              (analyze new runs only)');
    console.log('  npx tsx analyze.ts --reanalyze-all    (re-analyze all with current rubric)');
    console.log('  npx tsx analyze.ts --challenge <id>   (analyze/reanalyze runs for specific challenge)');
    process.exit(1);
  }

  let runIds: string[] = [];
  let forceReanalyze = args.includes('--reanalyze-all') || args.includes('--force');
  let challengeFilter: string | null = null;

  // Check for --challenge flag
  const challengeIdx = args.indexOf('--challenge');
  if (challengeIdx !== -1 && args[challengeIdx + 1]) {
    challengeFilter = args[challengeIdx + 1];
    forceReanalyze = true; // Always reanalyze when filtering by challenge
    console.log(chalk.cyan(`Filtering by challenge: ${challengeFilter}`));
  }

  if (args.includes('--all') || args.includes('--reanalyze-all') || challengeFilter) {
    // Find all runs
    const files = readdirSync(RESULTS_DIR);
    let runs = files
      .filter(f => f.endsWith('.json') && !f.includes('.analysis.'))
      .map(f => f.replace('.json', ''));

    // Filter by challenge if specified
    if (challengeFilter) {
      runs = runs.filter(runId => {
        const runPath = resolve(RESULTS_DIR, `${runId}.json`);
        try {
          const result: RunResult = JSON.parse(readFileSync(runPath, 'utf-8'));
          return result.challenge === challengeFilter;
        } catch {
          return false;
        }
      });
    }

    if (forceReanalyze) {
      runIds = runs;
    } else {
      runIds = runs.filter(id => !existsSync(resolve(RESULTS_DIR, `${id}.analysis.json`)));
    }

    console.log(chalk.cyan(`Found ${runIds.length} runs to analyze${forceReanalyze ? ' (force reanalyze)' : ''}`));
  } else {
    runIds = args.filter(a => !a.startsWith('--'));
  }

  if (runIds.length === 0) {
    console.log(chalk.green('All runs already analyzed!'));
    process.exit(0);
  }

  let success = 0;
  let failed = 0;

  for (const runId of runIds) {
    const result = await analyzeRunById(runId, forceReanalyze);
    if (result) success++;
    else failed++;
  }

  console.log(chalk.magenta.bold('\n📊 Summary'));
  console.log(chalk.green(`  ✓ Analyzed: ${success}`));
  if (failed > 0) {
    console.log(chalk.red(`  ✗ Failed: ${failed}`));
  }
}

main().catch(console.error);
