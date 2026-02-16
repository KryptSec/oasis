import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { colors, printHeader, formatScore } from '../lib/display.js';

const API_BASE = process.env.OASIS_API_URL || 'https://oasis.kryptsec.com';

interface LeaderboardEntry {
  rank: number;
  model: string;
  displayName: string;
  provider: string;
  kss: number;
  efficacy: number;
  efficiency: number;
  avgTime: string;
  challenges: string;
  lastRun: string;
  runCount: number;
}

export const leaderboardCommand = new Command('leaderboard')
  .description('Show the public leaderboard')
  .option('-n, --limit <number>', 'Number of entries to show', '10')
  .option('--json', 'Output as JSON', false)
  .action(async (options) => {
    const spinner = ora('Fetching leaderboard...').start();

    try {
      const response = await fetch(`${API_BASE}/api/oasis/leaderboard`);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const data = await response.json() as { entries?: LeaderboardEntry[] };
      const entries: LeaderboardEntry[] = data.entries || [];

      spinner.stop();

      if (entries.length === 0) {
        console.log(colors.yellow('\nNo benchmark data yet.'));
        console.log(colors.gray('  Be the first to submit a run!'));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(entries.slice(0, parseInt(options.limit)), null, 2));
        return;
      }

      printHeader('OASIS Leaderboard');
      console.log();

      // Table header
      console.log(
        colors.gray('  Rank  ') +
        colors.gray('Model'.padEnd(28)) +
        colors.gray('KSM'.padStart(8)) +
        colors.gray('Efficacy'.padStart(10)) +
        colors.gray('Time'.padStart(10))
      );
      console.log(colors.gray('  ' + '─'.repeat(70)));

      // Table rows
      const limit = parseInt(options.limit);
      for (const entry of entries.slice(0, limit)) {
        const rankIcon = getRankIcon(entry.rank);
        const modelName = entry.displayName.slice(0, 25).padEnd(25);
        const provider = colors.gray(`(${entry.provider.slice(0, 3)})`);

        const kss = formatScore(entry.kss).padStart(8);
        const efficacy = entry.efficacy.toString().padStart(10);
        const time = entry.avgTime.padStart(10);

        console.log(
          `  ${rankIcon}  ` +
          `${colors.white(modelName)} ${provider} ` +
          `${kss}` +
          `${colors.green(efficacy)}` +
          `${colors.cyan(time)}`
        );
      }

      console.log();
      console.log(colors.gray(`  Showing top ${Math.min(limit, entries.length)} of ${entries.length} models`));
      console.log(colors.gray(`  View full leaderboard: ${API_BASE}/oasis/leaderboard`));
      console.log();

    } catch (error) {
      spinner.fail('Failed to fetch leaderboard');

      if (error instanceof Error && error.message.includes('fetch')) {
        console.log(colors.gray('\n  Could not connect to OASIS API.'));
        console.log(colors.gray('  Check your internet connection or try again later.'));
      } else {
        console.error(colors.red(`\n  Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    }
  });

function getRankIcon(rank: number): string {
  switch (rank) {
    case 1:
      return colors.yellow.bold('#1');
    case 2:
      return colors.gray.bold('#2');
    case 3:
      return chalk.hex('#cd7f32').bold('#3');
    default:
      return colors.gray(`#${rank}`);
  }
}
