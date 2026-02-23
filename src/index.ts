#!/usr/bin/env node

import { createRequire } from 'module';
import { Command } from 'commander';
import { runCommand } from './commands/run.js';
import { analyzeCommand } from './commands/analyze.js';
import { resultsCommand } from './commands/results.js';
import { reportCommand } from './commands/report.js';
import { submitCommand } from './commands/submit.js';
import { challengesCommand } from './commands/challenges.js';
import { leaderboardCommand } from './commands/leaderboard.js';
import { validateCommand } from './commands/validate.js';
import { configCommand } from './commands/config.js';
import { providersCommand } from './commands/providers.js';
import { loginCommand } from './commands/login.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('oasis')
  .description('OASIS - AI Security Benchmarking CLI')
  .version(version);

// Register commands
program.addCommand(loginCommand);
program.addCommand(runCommand);
program.addCommand(analyzeCommand);
program.addCommand(resultsCommand);
program.addCommand(reportCommand);
program.addCommand(submitCommand);
program.addCommand(challengesCommand);
program.addCommand(leaderboardCommand);
program.addCommand(validateCommand);
program.addCommand(configCommand);
program.addCommand(providersCommand);

// If no arguments provided and running in a TTY, launch interactive mode
const userArgs = process.argv.slice(2);
if (userArgs.length === 0 && process.stdin.isTTY) {
  const { startInteractive } = await import('./interactive/index.js');
  await startInteractive();
} else {
  program.parse();
}
