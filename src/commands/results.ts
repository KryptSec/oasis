import { Command } from 'commander';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import Table from 'cli-table3';
import { colors, status, formatScore, formatTime, printBox, sectionHeader } from '../lib/display.js';
import { calculateKSM, calculateEfficacyFromResults } from '../lib/scoring.js';
import { getResultsDir, getChallengesDir } from '../lib/config.js';
import { resolveAnalysisPath, resolveResultPath, InvalidRunIdError, ResultPathEscapeError } from '../lib/results-path.js';
import type { RunResult, AnalysisResult, ChallengeConfig } from '../lib/types.js';

export const resultsCommand = new Command('results')
  .description('View and manage benchmark results');

resultsCommand
  .command('list')
  .description('List all saved benchmark results')
  .option('-n, --limit <n>', 'Number of results to show', '20')
  .option('--challenge <id>', 'Filter by challenge ID')
  .action((options) => {
    if (!existsSync(getResultsDir())) {
      console.log(colors.gray('\nNo results found. Run a benchmark first.'));
      return;
    }

    const files = readdirSync(getResultsDir())
      .filter(f => f.endsWith('.json') && !f.includes('.analysis.'))
      .map(f => {
        const fullPath = pathResolve(getResultsDir(), f);
        return {
          id: f.replace('.json', ''),
          path: fullPath,
          time: statSync(fullPath).mtime.getTime(),
        };
      })
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) {
      console.log(colors.gray('\nNo results found.'));
      return;
    }

    sectionHeader('Benchmark Results');
    const table = new Table({
      head: ['ID', 'Challenge', 'Model', 'Result', 'Time', 'Score'],
      style: { head: ['cyan'], border: ['gray'] },
    });

    const limit = parseInt(options.limit) || 20;

    // First pass: load all results (needed for multi-run efficacy)
    const loaded: { id: string; result: RunResult; analysis: AnalysisResult | null }[] = [];
    for (const file of files) {
      try {
        const result: RunResult = JSON.parse(readFileSync(file.path, 'utf-8'));
        if (options.challenge && result.challenge !== options.challenge) continue;

        const analysisPath = pathResolve(getResultsDir(), `${file.id}.analysis.json`);
        let analysis: AnalysisResult | null = null;
        if (existsSync(analysisPath)) {
          try {
            analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
          } catch {}
        }

        loaded.push({ id: file.id, result, analysis });
      } catch {
        // Skip malformed result files
      }
    }

    // Second pass: compute scores with proper multi-run efficacy
    const allResults = loaded.map(e => e.result);
    let count = 0;

    for (const { id, result, analysis } of loaded) {
      if (count >= limit) break;

      let score = '-';
      if (analysis) {
        try {
          const methodology = analysis.rubricScore?.percentage ?? analysis.strategy?.overallScore ?? 0;
          const s = calculateKSM(methodology, calculateEfficacyFromResults(result.challenge, result.modelVersion, allResults));
          score = s.toString();
        } catch {}
      }

      const resultStr = result.success ? colors.green('SUCCESS') : colors.red('FAILED');
      const timeStr = `${result.totalTime.toFixed(1)}s`;

      table.push([
        colors.cyan(id),
        colors.white(result.challenge),
        colors.gray((result.modelVersion || '').substring(0, 30)),
        resultStr,
        colors.yellow(timeStr),
        score !== '-' ? formatScore(parseFloat(score)) : colors.gray('-'),
      ]);
      count++;
    }

    console.log(table.toString());
    console.log(colors.gray(`\n  Showing ${count} of ${files.length} results.`));
    if (files.length > limit) {
      console.log(colors.gray(`Use --limit to show more.`));
    }
    console.log();
  });

resultsCommand
  .command('show')
  .description('Show details of a specific run')
  .argument('<run-id>', 'Run ID to show')
  .action((runId) => {
    let resultPath: string;
    let analysisPath: string;
    try {
      resultPath = resolveResultPath(runId);
      analysisPath = resolveAnalysisPath(runId);
    } catch (error) {
      if (error instanceof InvalidRunIdError || error instanceof ResultPathEscapeError) {
        console.error(colors.red(`\n${status.error} Invalid run ID: ${runId}`));
        console.log(colors.gray('  Use only letters, numbers, "_" or "-".'));
        process.exit(1);
      }
      throw error;
    }

    if (!existsSync(resultPath)) {
      console.error(colors.red(`\n${status.error} Run not found: ${runId}`));
      process.exit(1);
    }

    const result: RunResult = JSON.parse(readFileSync(resultPath, 'utf-8'));

    console.log();
    printBox([
      `  ${colors.gray('Run ID')}       ${colors.yellow(result.id)}`,
      `  ${colors.gray('Challenge')}    ${colors.white(result.challenge)}`,
      `  ${colors.gray('Model')}        ${colors.cyan(result.modelVersion)}`,
      `  ${colors.gray('Provider')}     ${colors.white(result.model)}`,
      `  ${colors.gray('Result')}       ${result.success ? colors.green('SUCCESS') : colors.red('FAILED')}`,
      `  ${colors.gray('Flag')}         ${result.flag ? colors.green(result.flag) : colors.gray('Not found')}`,
      `  ${colors.gray('Time')}         ${colors.yellow(result.totalTime.toFixed(1) + 's')}`,
      `  ${colors.gray('Iterations')}   ${colors.yellow(result.iterations.toString())}`,
      `  ${colors.gray('Tokens')}       ${colors.cyan(result.tokens.total.toLocaleString())}`,
      `  ${colors.gray('Tools')}        ${colors.white(result.toolsUsed?.join(', ') || 'N/A')}`,
    ].join('\n'), { title: 'Run Details' });

    if (result.techniquesUsed?.length > 0) {
      console.log();
      for (const tech of result.techniquesUsed) {
        console.log(`  ${colors.yellow(tech.id)} ${colors.white(tech.name)} ${colors.gray(`(${tech.tactic})`)}`);
      }
    }

    const analysisNote = existsSync(analysisPath)
      ? `Analysis: available (oasis analyze ${runId} to view)`
      : `Analysis: not run yet (oasis analyze ${runId})`;
    console.log(`\n  ${colors.gray(analysisNote)}`);
    console.log();
  });

resultsCommand
  .command('compare')
  .description('Compare benchmark runs side-by-side (two IDs or all runs for a challenge)')
  .argument('[id1]', 'First run ID (or use --challenge)')
  .argument('[id2]', 'Second run ID')
  .option('--challenge <id>', 'Compare all runs for a specific challenge')
  .action((id1, id2, options) => {
    // Mode: compare all runs for a challenge
    if (options.challenge) {
      compareByChallengeId(options.challenge);
      return;
    }

    // Mode: compare two specific runs
    if (!id1 || !id2) {
      console.error(colors.red(`\n${status.error} Provide two run IDs or use --challenge <id>`));
      process.exit(1);
    }

    let path1: string;
    let path2: string;
    let ap1: string;
    let ap2: string;
    try {
      path1 = resolveResultPath(id1);
      path2 = resolveResultPath(id2);
      ap1 = resolveAnalysisPath(id1);
      ap2 = resolveAnalysisPath(id2);
    } catch (error) {
      if (error instanceof InvalidRunIdError || error instanceof ResultPathEscapeError) {
        console.error(colors.red(`\n${status.error} Invalid run ID: ${error.runId}`));
        console.log(colors.gray('  Use only letters, numbers, "_" or "-".'));
        process.exit(1);
      }
      throw error;
    }

    if (!existsSync(path1)) {
      console.error(colors.red(`\n${status.error} Run not found: ${id1}`));
      process.exit(1);
    }
    if (!existsSync(path2)) {
      console.error(colors.red(`\n${status.error} Run not found: ${id2}`));
      process.exit(1);
    }

    const r1: RunResult = JSON.parse(readFileSync(path1, 'utf-8'));
    const r2: RunResult = JSON.parse(readFileSync(path2, 'utf-8'));

    // Load analyses if available
    let a1: AnalysisResult | null = null;
    let a2: AnalysisResult | null = null;
    if (existsSync(ap1)) a1 = JSON.parse(readFileSync(ap1, 'utf-8'));
    if (existsSync(ap2)) a2 = JSON.parse(readFileSync(ap2, 'utf-8'));

    sectionHeader('Run Comparison');
    const compareTable = new Table({
      head: ['Metric', id1, id2],
      style: { head: ['cyan'], border: ['gray'] },
    });

    const rows: [string, string, string][] = [
      ['Model', r1.modelVersion, r2.modelVersion],
      ['Challenge', r1.challenge, r2.challenge],
      ['Result', r1.success ? 'SUCCESS' : 'FAILED', r2.success ? 'SUCCESS' : 'FAILED'],
      ['Time', `${r1.totalTime.toFixed(1)}s`, `${r2.totalTime.toFixed(1)}s`],
      ['Iterations', r1.iterations.toString(), r2.iterations.toString()],
      ['Tokens', r1.tokens.total.toLocaleString(), r2.tokens.total.toLocaleString()],
    ];

    if (a1 || a2) {
      // Load all results once for multi-run efficacy calculation
      const allResults: RunResult[] = [];
      if (existsSync(getResultsDir())) {
        for (const f of readdirSync(getResultsDir()).filter(f => f.endsWith('.json') && !f.includes('.analysis.'))) {
          try {
            allResults.push(JSON.parse(readFileSync(pathResolve(getResultsDir(), f), 'utf-8')));
          } catch {}
        }
      }

      const s1 = calculateKSM(a1?.rubricScore?.percentage ?? a1?.strategy?.overallScore ?? 0, calculateEfficacyFromResults(r1.challenge, r1.modelVersion, allResults));
      const s2 = calculateKSM(a2?.rubricScore?.percentage ?? a2?.strategy?.overallScore ?? 0, calculateEfficacyFromResults(r2.challenge, r2.modelVersion, allResults));
      rows.push(['Score', s1 ? s1.toString() : 'N/A', s2 ? s2.toString() : 'N/A']);
      rows.push(['Approach', a1?.behavior?.approach || 'N/A', a2?.behavior?.approach || 'N/A']);
    }

    for (const [label, v1, v2] of rows) {
      compareTable.push([colors.gray(label), colors.white(v1), colors.white(v2)]);
    }
    console.log(compareTable.toString());
    console.log();
  });

// =============================================================================
// results summary — Aggregate view grouped by OWASP category
// =============================================================================

resultsCommand
  .command('summary')
  .description('Show aggregate results grouped by OWASP category')
  .action(() => {
    const resultsDir = getResultsDir();
    const challengesDir = getChallengesDir();

    if (!existsSync(resultsDir)) {
      console.log(colors.gray('\nNo results found. Run a benchmark first.'));
      return;
    }

    // Load all results and their analyses
    const resultFiles = readdirSync(resultsDir)
      .filter(f => f.endsWith('.json') && !f.includes('.analysis.'));

    if (resultFiles.length === 0) {
      console.log(colors.gray('\nNo results found.'));
      return;
    }

    // Build a map of challenge ID -> OWASP categories from challenge configs
    const challengeOwasp: Record<string, string[]> = {};
    const challengeDifficulty: Record<string, string> = {};
    if (existsSync(challengesDir)) {
      const dirs = readdirSync(challengesDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_'));
      for (const dir of dirs) {
        const configPath = pathResolve(challengesDir, dir.name, 'challenge.json');
        if (existsSync(configPath)) {
          try {
            const config: ChallengeConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
            if (config.expectedApproach?.owaspCategory) {
              challengeOwasp[config.id] = config.expectedApproach.owaspCategory;
            }
            challengeDifficulty[config.id] = config.difficulty;
          } catch {}
        }
      }
    }

    // Collect all run data grouped by challenge
    interface RunEntry {
      result: RunResult;
      analysis: AnalysisResult | null;
      score: number;
    }
    const byChallenge: Record<string, RunEntry[]> = {};

    // First pass: load all results and analyses
    const allLoadedEntries: { result: RunResult; analysis: AnalysisResult | null }[] = [];
    for (const file of resultFiles) {
      try {
        const filePath = pathResolve(resultsDir, file);
        const result: RunResult = JSON.parse(readFileSync(filePath, 'utf-8'));
        const analysisPath = pathResolve(resultsDir, file.replace('.json', '.analysis.json'));
        let analysis: AnalysisResult | null = null;

        if (existsSync(analysisPath)) {
          try {
            analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
          } catch {}
        }

        allLoadedEntries.push({ result, analysis });
      } catch {}
    }

    // Second pass: compute scores with proper multi-run efficacy
    const allLoadedResults = allLoadedEntries.map(e => e.result);
    for (const { result, analysis } of allLoadedEntries) {
      let score = 0;
      if (analysis) {
        const methodology = analysis.rubricScore?.percentage ?? analysis.strategy?.overallScore ?? 0;
        const efficacy = calculateEfficacyFromResults(result.challenge, result.modelVersion, allLoadedResults);
        score = calculateKSM(methodology, efficacy);
      }

      if (!byChallenge[result.challenge]) {
        byChallenge[result.challenge] = [];
      }
      byChallenge[result.challenge].push({ result, analysis, score });
    }

    // Group by OWASP category
    interface CategorySummary {
      category: string;
      challenges: string[];
      totalRuns: number;
      successRate: number;
      bestScore: number;
      avgScore: number;
      bestModel: string;
    }

    const byOwasp: Record<string, CategorySummary> = {};
    const uncategorized: string[] = [];

    for (const [challengeId, runs] of Object.entries(byChallenge)) {
      const categories = challengeOwasp[challengeId];
      if (!categories || categories.length === 0) {
        uncategorized.push(challengeId);
      }

      const targetCategories = categories && categories.length > 0
        ? categories
        : ['Uncategorized'];

      for (const cat of targetCategories) {
        if (!byOwasp[cat]) {
          byOwasp[cat] = {
            category: cat,
            challenges: [],
            totalRuns: 0,
            successRate: 0,
            bestScore: 0,
            avgScore: 0,
            bestModel: '-',
          };
        }

        const summary = byOwasp[cat];
        if (!summary.challenges.includes(challengeId)) {
          summary.challenges.push(challengeId);
        }

        summary.totalRuns += runs.length;
        const successes = runs.filter(r => r.result.success).length;
        const totalSuccessRate = successes / runs.length;
        summary.successRate = Math.round(totalSuccessRate * 100);

        const scoredRuns = runs.filter(r => r.score > 0);
        if (scoredRuns.length > 0) {
          const best = scoredRuns.reduce((a, b) => a.score > b.score ? a : b);
          if (best.score > summary.bestScore) {
            summary.bestScore = best.score;
            summary.bestModel = best.result.modelVersion;
          }
          summary.avgScore = Math.round(
            scoredRuns.reduce((sum, r) => sum + r.score, 0) / scoredRuns.length
          );
        }
      }
    }

    // Sort OWASP categories
    const sortedCategories = Object.values(byOwasp).sort((a, b) => {
      // Sort A01, A02, etc. naturally; Uncategorized goes last
      if (a.category === 'Uncategorized') return 1;
      if (b.category === 'Uncategorized') return -1;
      return a.category.localeCompare(b.category);
    });

    // Display
    sectionHeader('OASIS Results Summary');
    const summaryTable = new Table({
      head: ['OWASP Category', 'Labs', 'Runs', 'Success', 'Best', 'Avg', 'Best Model'],
      style: { head: ['cyan'], border: ['gray'] },
    });

    let totalChallenges = 0;
    let totalRuns = 0;
    let totalScoreSum = 0;
    let totalScoredCount = 0;

    for (const cat of sortedCategories) {
      const categoryDisplay = cat.category.length > 33
        ? cat.category.substring(0, 30) + '...'
        : cat.category;

      const successStr = cat.successRate > 0
        ? (cat.successRate >= 75 ? colors.green : cat.successRate >= 50 ? colors.yellow : colors.red)(`${cat.successRate}%`)
        : colors.gray('-');

      const bestStr = cat.bestScore > 0 ? formatScore(cat.bestScore) : colors.gray('-');
      const avgStr = cat.avgScore > 0 ? formatScore(cat.avgScore) : colors.gray('-');
      const modelStr = cat.bestModel !== '-'
        ? colors.white(cat.bestModel.length > 25 ? cat.bestModel.substring(0, 22) + '...' : cat.bestModel)
        : colors.gray('-');

      summaryTable.push([
        colors.cyan(categoryDisplay),
        colors.white(cat.challenges.length.toString()),
        colors.white(cat.totalRuns.toString()),
        successStr,
        bestStr,
        avgStr,
        modelStr,
      ]);

      totalChallenges += cat.challenges.length;
      totalRuns += cat.totalRuns;
      if (cat.avgScore > 0) {
        totalScoreSum += cat.avgScore;
        totalScoredCount++;
      }
    }

    console.log(summaryTable.toString());
    const overallAvg = totalScoredCount > 0 ? Math.round(totalScoreSum / totalScoredCount) : 0;
    console.log(
      colors.white(
        `\n  ${totalChallenges} challenges | ${totalRuns} total runs | ` +
        `Avg KSM: ${overallAvg > 0 ? overallAvg.toString() : 'N/A'}`
      )
    );
    console.log();
  });

// =============================================================================
// compare --challenge: Compare all runs for a specific challenge
// =============================================================================

function compareByChallengeId(challengeId: string): void {
  const resultsDir = getResultsDir();
  const challengesDir = getChallengesDir();

  if (!existsSync(resultsDir)) {
    console.log(colors.gray('\nNo results found.'));
    return;
  }

  // Load challenge config for OWASP category display
  let owaspLabel = '';
  const challengeConfigPath = pathResolve(challengesDir, challengeId, 'challenge.json');
  if (existsSync(challengeConfigPath)) {
    try {
      const config: ChallengeConfig = JSON.parse(readFileSync(challengeConfigPath, 'utf-8'));
      if (config.expectedApproach?.owaspCategory?.[0]) {
        owaspLabel = ` (${config.expectedApproach.owaspCategory[0]})`;
      }
    } catch {}
  }

  // Find all runs for this challenge
  interface RunEntry {
    result: RunResult;
    analysis: AnalysisResult | null;
    score: number;
  }
  const runs: RunEntry[] = [];

  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith('.json') && !f.includes('.analysis.'));

  // First pass: load all runs for this challenge
  const loadedEntries: { result: RunResult; analysis: AnalysisResult | null }[] = [];
  for (const file of files) {
    try {
      const filePath = pathResolve(resultsDir, file);
      const result: RunResult = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (result.challenge !== challengeId) continue;

      const analysisPath = pathResolve(resultsDir, file.replace('.json', '.analysis.json'));
      let analysis: AnalysisResult | null = null;

      if (existsSync(analysisPath)) {
        try {
          analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
        } catch {}
      }

      loadedEntries.push({ result, analysis });
    } catch {}
  }

  // Second pass: compute scores with proper multi-run efficacy
  const challengeResults = loadedEntries.map(e => e.result);
  for (const { result, analysis } of loadedEntries) {
    let score = 0;
    if (analysis) {
      const methodology = analysis.rubricScore?.percentage ?? analysis.strategy?.overallScore ?? 0;
      const efficacy = calculateEfficacyFromResults(result.challenge, result.modelVersion, challengeResults);
      score = calculateKSM(methodology, efficacy);
    }
    runs.push({ result, analysis, score });
  }

  if (runs.length === 0) {
    console.log(colors.gray(`\nNo runs found for challenge: ${challengeId}`));
    return;
  }

  // Sort by score descending, then by time ascending
  runs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.result.totalTime - b.result.totalTime;
  });

  sectionHeader(`Challenge: ${challengeId}${owaspLabel}`);
  const challengeTable = new Table({
    head: ['Model', 'Result', 'KSM', 'Time', 'Steps', 'Approach'],
    style: { head: ['cyan'], border: ['gray'] },
  });

  for (const run of runs) {
    const model = (run.result.modelVersion || '').length > 26
      ? run.result.modelVersion.substring(0, 23) + '...'
      : run.result.modelVersion;
    const resultStr = run.result.success
      ? colors.green('SUCCESS')
      : colors.red('FAILED');
    const scoreStr = run.score > 0 ? formatScore(run.score) : colors.gray('-');
    const timeStr = colors.yellow(formatTime(run.result.totalTime));
    const stepsStr = colors.white(run.result.iterations.toString());
    const approachStr = run.analysis?.behavior?.approach
      ? colors.cyan(run.analysis.behavior.approach)
      : colors.gray('-');

    challengeTable.push([
      colors.white(model),
      resultStr,
      scoreStr,
      timeStr,
      stepsStr,
      approachStr,
    ]);
  }

  console.log(challengeTable.toString());
  console.log(colors.gray(`\n  ${runs.length} run${runs.length !== 1 ? 's' : ''} found.`));
  console.log();
}
