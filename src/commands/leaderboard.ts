import { Command } from 'commander';
import { colors } from '../lib/display.js';

export const leaderboardCommand = new Command('leaderboard')
  .description('View the public benchmark leaderboard')
  .action(async () => {
    console.log();
    console.log(colors.cyan.bold('OASIS Leaderboard'));
    console.log();
    console.log(colors.white('  The public leaderboard is coming in OASIS v2.'));
    console.log();
    console.log(colors.gray('  In v2 you will be able to:'));
    console.log(colors.gray('    - View ranked model performance across challenges'));
    console.log(colors.gray('    - Filter by OWASP category, difficulty, and provider'));
    console.log(colors.gray('    - See detailed scoring breakdowns'));
    console.log();
    console.log(colors.gray('  For now, view your local results:'));
    console.log(colors.white('    oasis results list'));
    console.log(colors.white('    oasis results summary'));
    console.log();
  });
