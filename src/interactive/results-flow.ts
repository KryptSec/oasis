import { select } from '@inquirer/prompts';
import { colors, status, formatScore, formatTime, printBox } from '../lib/display.js';
import { printColorReport, printAnalysisSummary } from '../lib/report.js';
import { promptExport } from '../lib/export.js';
import { loadRecentResults } from './helpers.js';
import type { LoadedResult } from './helpers.js';

export async function viewResultsFlow(): Promise<void> {
  const results = loadRecentResults(20);

  if (results.length === 0) {
    console.log(colors.gray('\n  No results found. Run a benchmark first.\n'));
    return;
  }

  while (true) {
    const choices = results.map(r => {
      const resultStr = r.result.success ? colors.green('SUCCESS') : colors.red('FAILED');
      const scoreStr = r.score > 0 ? formatScore(r.score) : colors.gray('-');
      const model = (r.result.modelVersion || '').length > 25
        ? r.result.modelVersion.substring(0, 22) + '...'
        : r.result.modelVersion;
      return {
        name: `${colors.cyan(r.id)} | ${colors.white(r.result.challenge.padEnd(15))} | ${colors.gray(model.padEnd(25))} | ${resultStr} | ${scoreStr}`,
        value: r.id,
      };
    });

    choices.push({ name: colors.gray('Back to main menu'), value: '__back__' });

    const selectedId = await select({
      message: 'Select a run to view',
      choices,
    });

    if (selectedId === '__back__') return;

    const entry = results.find(r => r.id === selectedId);
    if (!entry) continue;

    await showRunDetail(entry);
  }
}

async function showRunDetail(entry: LoadedResult): Promise<void> {
  const { result, analysis } = entry;

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

  console.log();

  // Sub-menu for this run
  const detailChoices = [
    ...(analysis ? [{ name: 'View analysis summary', value: 'analysis' as const }] : []),
    { name: 'View detailed report', value: 'report' as const },
    { name: 'Share / export', value: 'export' as const },
    { name: 'Back to results list', value: 'back' as const },
  ];

  const action = await select({
    message: 'What would you like to do?',
    choices: detailChoices,
  });

  switch (action) {
    case 'analysis':
      if (analysis) {
        printAnalysisSummary(analysis);
      }
      break;
    case 'report':
      printColorReport(result);
      break;
    case 'export':
      await promptExport(result, analysis ?? undefined, entry.score > 0 ? entry.score : undefined);
      break;
    case 'back':
      break;
  }
}
