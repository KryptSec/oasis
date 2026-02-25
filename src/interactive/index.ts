import { select } from '@inquirer/prompts';
import { printBanner, colors, printBox } from '../lib/display.js';
import { runBenchmarkFlow } from './run-flow.js';
import { viewResultsFlow } from './results-flow.js';
import { configureKeysFlow } from './config-flow.js';

export async function startInteractive(): Promise<void> {
  printBanner();

  try {
    while (true) {
      const action = await select({
        message: 'What would you like to do?',
        choices: [
          { name: 'Run Benchmark', value: 'run', description: 'Run an AI security benchmark against a challenge' },
          { name: 'View Results', value: 'results', description: 'Browse and inspect past benchmark runs' },
          { name: 'Configure API Keys', value: 'config', description: 'Manage API keys and provider settings' },
          { name: 'Advanced Mode', value: 'advanced', description: 'Show CLI commands for power users' },
          { name: 'Exit', value: 'exit' },
        ],
      });

      switch (action) {
        case 'run':
          await runBenchmarkFlow();
          break;
        case 'results':
          await viewResultsFlow();
          break;
        case 'config':
          await configureKeysFlow();
          break;
        case 'advanced':
          printAdvancedHelp();
          break;
        case 'exit':
          console.log(colors.gray('\n  Goodbye.\n'));
          return;
      }
    }
  } catch (error) {
    // ExitPromptError is thrown on Ctrl+C — exit gracefully
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ExitPromptError') {
      console.log(colors.gray('\n  Goodbye.\n'));
      return;
    }
    throw error;
  }
}

function printAdvancedHelp(): void {
  const commands = [
    `${colors.cyan('oasis run')}           Run a benchmark`,
    `  ${colors.gray('-c, --challenge')}    Challenge ID`,
    `  ${colors.gray('-m, --model')}        Model to use`,
    `  ${colors.gray('-p, --provider')}     Provider (anthropic, openai, xai, google, ollama)`,
    `  ${colors.gray('--no-analyze')}       Skip post-run analysis`,
    '',
    `${colors.cyan('oasis results list')}  List all benchmark results`,
    `${colors.cyan('oasis results show')}  Show details of a run`,
    `${colors.cyan('oasis analyze')}       Run analysis on an existing result`,
    `${colors.cyan('oasis challenges')}    List available challenges`,
    `${colors.cyan('oasis report')}        Generate reports (text, json, markdown)`,
    `${colors.cyan('oasis config')}        Manage configuration`,
    `${colors.cyan('oasis providers')}     List supported providers`,
    `${colors.cyan('oasis leaderboard')}   View the leaderboard`,
    `${colors.cyan('oasis validate')}      Validate a challenge`,
    '',
    colors.gray('Run any command with --help for full options.'),
  ];

  console.log();
  printBox(commands.join('\n'), { title: 'CLI Commands' });
  console.log();
}
