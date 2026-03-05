import { select, input } from '@inquirer/prompts';
import { writeFileSync } from 'fs';
import { resolve as pathResolve, dirname } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { colors, status } from './display.js';
import { copyToClipboard, generateShareCard, generateHtmlReport } from './report.js';
import type { RunResult, AnalysisResult } from './types.js';

export async function promptExport(
  result: RunResult,
  analysis?: AnalysisResult,
  ksmScore?: number,
): Promise<void> {
  console.log();
  if (!analysis || analysis.parseFailed) {
    console.log(colors.gray('  No analysis available — skipping export.'));
    console.log(colors.gray(`  Run analysis first: oasis analyze ${result.id}`));
    console.log(colors.gray(`  Then export via: oasis report ${result.id}`));
    return;
  }
  console.log(colors.gray(`  More export formats available via: oasis report ${result.id}`));

  let hasActed = false;
  while (true) {
    const exportChoices = [
      { name: 'Copy share card to clipboard', value: 'share' as const },
      { name: 'Save HTML report', value: 'html' as const },
    ];
    const doneChoice = { name: hasActed ? 'Done' : colors.gray('Done'), value: 'done' as const };
    const choices = hasActed
      ? [doneChoice, ...exportChoices]
      : [...exportChoices, doneChoice];

    const action = await select({
      message: 'Share results?',
      choices,
    });

    if (action === 'done') break;
    hasActed = true;

    if (action === 'share') {
      const card = generateShareCard(result, analysis, ksmScore);
      if (copyToClipboard(card)) {
        console.log(colors.green(`  ${status.success} Share card copied to clipboard!`));
      } else {
        console.log(colors.yellow(`  ${status.warning} Could not copy to clipboard. Card printed below:\n`));
        console.log(card);
      }
    }

    if (action === 'html') {
      const defaultPath = pathResolve(homedir(), 'Desktop', `oasis-${result.id}.html`);
      const outputPath = await input({
        message: 'Save to:',
        default: defaultPath,
      });

      const resolved = pathResolve(outputPath);
      const parent = dirname(resolved);
      if (!existsSync(parent)) {
        console.log(colors.red(`  ${status.error} Directory does not exist: ${parent}`));
        continue;
      }

      try {
        const html = generateHtmlReport(result, analysis, ksmScore);
        writeFileSync(resolved, html, { mode: 0o644 });
        console.log(colors.green(`  ${status.success} Report saved to: ${resolved}`));
      } catch (err) {
        console.log(colors.red(`  ${status.error} Failed to write: ${err instanceof Error ? err.message : 'Unknown error'}`));
      }
    }
  }
}
