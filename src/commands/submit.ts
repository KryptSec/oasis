import { Command } from 'commander';
import { colors } from '../lib/display.js';

export const submitCommand = new Command('submit')
  .description('Submit a benchmark run to the public leaderboard')
  .argument('[run-id]', 'Run ID to submit')
  .action(async () => {
    console.log();
    console.log(colors.cyan.bold('OASIS Leaderboard Submissions'));
    console.log();
    console.log(colors.white('  Leaderboard submissions are coming in OASIS v2.'));
    console.log();
    console.log(colors.gray('  In v2 you will be able to:'));
    console.log(colors.gray('    - Submit verified runs to the public leaderboard'));
    console.log(colors.gray('    - Compare your results against the community'));
    console.log(colors.gray('    - Track model performance over time'));
    console.log();
    console.log(colors.gray('  For now, compare runs locally:'));
    console.log(colors.white('    oasis results compare <id1> <id2>'));
    console.log();
  });
