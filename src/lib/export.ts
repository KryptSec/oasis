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
  if (!analysis) {
    console.log(colors.gray('  No analysis available — export will not include scores.'));
  }
  console.log(colors.gray(`  More export formats available via: oasis report ${result.id}`));

  while (true) {
    const action = await select({
      message: 'Share results?',
      choices: [
        { name: 'Copy share card to clipboard', value: 'share' as const },
        { name: 'Save HTML report', value: 'html' as const },
        { name: colors.gray('Done'), value: 'done' as const },
      ],
    });

    if (action === 'done') break;

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

      const html = generateHtmlReport(result, analysis, ksmScore);
      writeFileSync(resolved, html, { mode: 0o644 });
      console.log(colors.green(`  ${status.success} Report saved to: ${resolved}`));
    }
  }
}
