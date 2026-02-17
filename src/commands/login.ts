import { Command } from 'commander';
import { colors } from '../lib/display.js';

export const loginCommand = new Command('login')
  .description('Authenticate with your account for verified runs and leaderboard submissions')
  .action(async () => {
    console.log();
    console.log(colors.cyan.bold('OASIS Authentication'));
    console.log();
    console.log(colors.white('  Platform authentication is coming in OASIS v2.'));
    console.log();
    console.log(colors.gray('  In v2 you will be able to:'));
    console.log(colors.gray('    - Run verified benchmarks on managed infrastructure'));
    console.log(colors.gray('    - Submit results to the public leaderboard'));
    console.log(colors.gray('    - Track your benchmark history'));
    console.log();
    console.log(colors.gray('  For now, run benchmarks locally:'));
    console.log(colors.white('    oasis run -c <challenge> -m <model>'));
    console.log();
  });
