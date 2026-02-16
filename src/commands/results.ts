import { Command } from 'commander';
import { resolve as pathResolve } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { colors, status, formatScore, formatTime } from '../lib/display.js';
import { getResultsDir } from '../lib/config.js';
import type { RunResult, AnalysisResult } from '../lib/types.js';

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

    console.log(colors.white.bold('\nBenchmark Results\n'));
    console.log(colors.gray(`${'ID'.padEnd(12)} ${'Challenge'.padEnd(15)} ${'Model'.padEnd(30)} ${'Result'.padEnd(10)} ${'Time'.padEnd(8)} Score`));
    console.log(colors.gray('─'.repeat(90)));

    let count = 0;
    const limit = parseInt(options.limit) || 20;

    for (const file of files) {
      if (count >= limit) break;

      try {
        const result: RunResult = JSON.parse(readFileSync(file.path, 'utf-8'));

        if (options.challenge && result.challenge !== options.challenge) continue;

        // Check for analysis
        const analysisPath = pathResolve(getResultsDir(), `${file.id}.analysis.json`);
        let score = '-';
        if (existsSync(analysisPath)) {
          try {
            const analysis: AnalysisResult = JSON.parse(readFileSync(analysisPath, 'utf-8'));
            const s = analysis.rubricScore?.total || analysis.strategy?.overallScore || 0;
            score = s.toString();
          } catch {}
        }

        const resultStr = result.success ? colors.green('SUCCESS') : colors.red('FAILED');
        const timeStr = `${result.totalTime.toFixed(1)}s`;

        console.log(
          `${colors.cyan(file.id.padEnd(12))} ` +
          `${colors.white(result.challenge.padEnd(15))} ` +
          `${colors.gray((result.modelVersion || '').padEnd(30))} ` +
          `${resultStr.padEnd(10)} ` +
          `${colors.yellow(timeStr.padEnd(8))} ` +
          `${score !== '-' ? formatScore(parseFloat(score)) : colors.gray('-')}`
        );
        count++;
      } catch {
        // Skip malformed result files
      }
    }

    console.log(colors.gray(`\nShowing ${count} of ${files.length} results.`));
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
    const resultPath = pathResolve(getResultsDir(), `${runId}.json`);
    if (!existsSync(resultPath)) {
      console.error(colors.red(`\n${status.error} Run not found: ${runId}`));
      process.exit(1);
    }

    const result: RunResult = JSON.parse(readFileSync(resultPath, 'utf-8'));

    console.log(colors.white.bold(`\nRun: ${result.id}`));
    console.log(colors.gray('─'.repeat(50)));
    console.log(`  ${colors.gray('Challenge:')}    ${colors.white(result.challenge)}`);
    console.log(`  ${colors.gray('Model:')}        ${colors.white(result.modelVersion)}`);
    console.log(`  ${colors.gray('Provider:')}     ${colors.white(result.model)}`);
    console.log(`  ${colors.gray('Result:')}       ${result.success ? colors.green('SUCCESS') : colors.red('FAILED')}`);
    console.log(`  ${colors.gray('Flag:')}         ${result.flag ? colors.green(result.flag) : colors.gray('Not found')}`);
    console.log(`  ${colors.gray('Time:')}         ${colors.yellow(result.totalTime.toFixed(1) + 's')}`);
    console.log(`  ${colors.gray('Iterations:')}   ${colors.yellow(result.iterations.toString())}`);
    console.log(`  ${colors.gray('Tokens:')}       ${colors.cyan(result.tokens.total.toLocaleString())}`);
    console.log(`  ${colors.gray('Tools Used:')}   ${colors.white(result.toolsUsed?.join(', ') || 'N/A')}`);

    // Show techniques if available
    if (result.techniquesUsed?.length > 0) {
      console.log(colors.gray('\n  ATT&CK Techniques:'));
      for (const tech of result.techniquesUsed) {
        console.log(`    ${colors.yellow(tech.id)} ${colors.white(tech.name)} ${colors.gray(`(${tech.tactic})`)}`);
      }
    }

    // Check for analysis
    const analysisPath = pathResolve(getResultsDir(), `${runId}.analysis.json`);
    if (existsSync(analysisPath)) {
      console.log(colors.gray(`\n  Analysis: available (oasis analyze ${runId} to view)`));
    } else {
      console.log(colors.gray(`\n  Analysis: not run yet (oasis analyze ${runId})`));
    }

    console.log();
  });

resultsCommand
  .command('compare')
  .description('Compare two benchmark runs side-by-side')
  .argument('<id1>', 'First run ID')
  .argument('<id2>', 'Second run ID')
  .action((id1, id2) => {
    const path1 = pathResolve(getResultsDir(), `${id1}.json`);
    const path2 = pathResolve(getResultsDir(), `${id2}.json`);

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
    const ap1 = pathResolve(getResultsDir(), `${id1}.analysis.json`);
    const ap2 = pathResolve(getResultsDir(), `${id2}.analysis.json`);
    if (existsSync(ap1)) a1 = JSON.parse(readFileSync(ap1, 'utf-8'));
    if (existsSync(ap2)) a2 = JSON.parse(readFileSync(ap2, 'utf-8'));

    const col = 30;

    console.log(colors.white.bold('\nRun Comparison\n'));
    console.log(colors.gray(`${'Metric'.padEnd(22)} ${id1.padEnd(col)} ${id2.padEnd(col)}`));
    console.log(colors.gray('─'.repeat(22 + col * 2 + 2)));

    const rows: [string, string, string][] = [
      ['Model', r1.modelVersion, r2.modelVersion],
      ['Challenge', r1.challenge, r2.challenge],
      ['Result', r1.success ? 'SUCCESS' : 'FAILED', r2.success ? 'SUCCESS' : 'FAILED'],
      ['Time', `${r1.totalTime.toFixed(1)}s`, `${r2.totalTime.toFixed(1)}s`],
      ['Iterations', r1.iterations.toString(), r2.iterations.toString()],
      ['Tokens', r1.tokens.total.toLocaleString(), r2.tokens.total.toLocaleString()],
    ];

    if (a1 || a2) {
      const s1 = a1?.rubricScore?.total || a1?.strategy?.overallScore || 0;
      const s2 = a2?.rubricScore?.total || a2?.strategy?.overallScore || 0;
      rows.push(['Score', s1 ? s1.toString() : 'N/A', s2 ? s2.toString() : 'N/A']);
      rows.push(['Approach', a1?.behavior?.approach || 'N/A', a2?.behavior?.approach || 'N/A']);
    }

    for (const [label, v1, v2] of rows) {
      console.log(`  ${colors.gray(label.padEnd(20))} ${colors.white(v1.padEnd(col))} ${colors.white(v2.padEnd(col))}`);
    }

    console.log();
  });
