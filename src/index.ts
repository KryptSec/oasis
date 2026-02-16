#!/usr/bin/env node

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

const program = new Command();

program
  .name('oasis')
  .description('OASIS - AI Security Benchmarking CLI')
  .version('0.1.0');

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

// Parse arguments
program.parse();
