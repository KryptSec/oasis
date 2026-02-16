import chalk from 'chalk';

// Color scheme matching the web UI
export const colors = {
  purple: chalk.hex('#a855f7'),
  cyan: chalk.hex('#22d3ee'),
  green: chalk.hex('#22c55e'),
  yellow: chalk.hex('#eab308'),
  red: chalk.hex('#ef4444'),
  gray: chalk.hex('#9ca3af'),
  white: chalk.white,
  bold: chalk.bold,
};

// Status indicators
export const status = {
  success: colors.green('✓'),
  error: colors.red('✗'),
  warning: colors.yellow('⚠'),
  info: colors.cyan('→'),
  pending: colors.gray('○'),
};

// Format KSM score with color
export function formatScore(score: number): string {
  let color = colors.red;
  if (score >= 90) color = colors.green;
  else if (score >= 80) color = colors.cyan;
  else if (score >= 70) color = colors.yellow;

  return color.bold(score.toFixed(1));
}

// Format time duration
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// Print the score summary line
export function printScoreSummary(score: {
  kss: number;
  efficacy: number;
  efficiency: number;
  time: number;
}): void {
  const parts = [
    `${colors.white('KSM Score:')} ${formatScore(score.kss)}`,
    `${colors.white('Efficacy:')} ${colors.green(score.efficacy.toString())}`,
    `${colors.white('Efficiency:')} ${colors.yellow(score.efficiency.toFixed(1))}`,
    `${colors.white('Time:')} ${colors.cyan(formatTime(score.time))}`,
  ];

  console.log('\n' + parts.join(' | '));
}

// Print a header
export function printHeader(text: string): void {
  console.log('\n' + colors.purple.bold(text));
  console.log(colors.gray('─'.repeat(text.length + 4)));
}

// Print a table row
export function printRow(label: string, value: string, width = 20): void {
  const paddedLabel = label.padEnd(width);
  console.log(`  ${colors.gray(paddedLabel)} ${value}`);
}

// Print banner
export function printBanner(): void {
  console.log(colors.purple.bold(`
   ██████╗  █████╗ ███████╗██╗███████╗
  ██╔═══██╗██╔══██╗██╔════╝██║██╔════╝
  ██║   ██║███████║███████╗██║███████╗
  ██║   ██║██╔══██║╚════██║██║╚════██║
  ╚██████╔╝██║  ██║███████║██║███████║
   ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝╚══════╝
`));
  console.log(colors.gray('  AI Security Benchmarking\n'));
}

// Format difficulty badge
export function formatDifficulty(difficulty: string): string {
  switch (difficulty.toLowerCase()) {
    case 'easy':
      return colors.green(difficulty);
    case 'medium':
      return colors.yellow(difficulty);
    case 'hard':
      return colors.red(difficulty);
    case 'expert':
      return chalk.hex('#dc2626').bold(difficulty);
    default:
      return colors.gray(difficulty);
  }
}

// Format category badge
export function formatCategory(category: string): string {
  return colors.cyan(`[${category}]`);
}
