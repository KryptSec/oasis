import chalk from 'chalk';
import gradient from 'gradient-string';
import boxen, { type Options as BoxenOptions } from 'boxen';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

// =============================================================================
// Color Palette (matches web UI)
// =============================================================================

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

// =============================================================================
// Status Indicators
// =============================================================================

export const status = {
  success: colors.green('✓'),
  error: colors.red('✗'),
  warning: colors.yellow('⚠'),
  info: colors.cyan('→'),
  pending: colors.gray('○'),
};

// =============================================================================
// Brand Gradient
// =============================================================================

export const brandGradient: (text: string) => string = gradient(['#a855f7', '#22d3ee']);

// =============================================================================
// Terminal Width
// =============================================================================

export function getTerminalWidth(): number {
  return Math.max(process.stdout.columns || 80, 80);
}

// =============================================================================
// Score Utilities
// =============================================================================

export function getScoreColorFn(score: number): typeof colors.red {
  if (score >= 80) return colors.green;
  if (score >= 60) return colors.yellow;
  if (score >= 40) return chalk.hex('#FFA500') as typeof colors.red;
  return colors.red;
}

export function formatScore(score: number): string {
  let color = colors.red;
  if (score >= 90) color = colors.green;
  else if (score >= 80) color = colors.cyan;
  else if (score >= 70) color = colors.yellow;

  return color.bold(score.toFixed(1));
}

export function renderScoreBar(score: number, width = 20, showValue = true): string {
  const clamped = Math.max(0, Math.min(score, 100));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = getScoreColorFn(score)('█'.repeat(filled)) + colors.gray('░'.repeat(empty));
  if (showValue) {
    return `${bar} ${getScoreColorFn(score)(score.toString().padStart(3))}/100`;
  }
  return bar;
}

// =============================================================================
// Time Formatting
// =============================================================================

export function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// =============================================================================
// Layout Primitives
// =============================================================================

export function printBox(content: string, options?: {
  title?: string;
  titleAlignment?: 'left' | 'center' | 'right';
  borderColor?: string;
  dimBorder?: boolean;
}): void {
  const width = Math.min(getTerminalWidth() - 4, 72);
  console.log(boxen(content, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    borderStyle: 'round',
    borderColor: (options?.borderColor || '#a855f7') as string,
    dimBorder: options?.dimBorder ?? true,
    width,
    ...(options?.title ? { title: options.title, titleAlignment: options.titleAlignment || 'left' } : {}),
  }));
}

export function sectionHeader(text: string): void {
  const maxWidth = Math.min(getTerminalWidth() - 4, 72);
  const textLen = text.length + 2;
  const leftDash = 4;
  const rightDash = Math.max(2, maxWidth - textLen - leftDash);
  console.log(`\n  ${colors.gray('─'.repeat(leftDash))} ${colors.cyan.bold(text)} ${colors.gray('─'.repeat(rightDash))}`);
}

export function divider(): void {
  const width = Math.min(getTerminalWidth() - 4, 72);
  console.log(`  ${colors.gray('─'.repeat(width))}`);
}

// =============================================================================
// Score Summary
// =============================================================================

export function printScoreSummary(score: {
  ksm: number;
  efficacy: number;
  efficiency: number;
  time: number;
}): void {
  const barWidth = 25;
  const clampedKsm = Math.max(0, Math.min(score.ksm, 100));
  const filled = Math.round((clampedKsm / 100) * barWidth);
  const bar = getScoreColorFn(score.ksm)('█'.repeat(filled)) + colors.gray('░'.repeat(barWidth - filled));

  const lines = [
    '',
    `  ${colors.gray('KSM Score')}   ${formatScore(score.ksm)}`,
    `  ${bar}`,
    '',
    `  ${colors.gray('Efficacy')}  ${colors.green(score.efficacy.toString() + '%')}` +
    `     ${colors.gray('Efficiency')}  ${colors.yellow(score.efficiency.toFixed(1))}` +
    `     ${colors.gray('Time')}  ${colors.cyan(formatTime(score.time))}`,
    '',
  ];

  printBox(lines.join('\n'));
}

// =============================================================================
// Headers & Rows
// =============================================================================

export function printHeader(text: string): void {
  console.log();
  console.log(`  ${brandGradient(text)}`);
  console.log(`  ${colors.gray('─'.repeat(Math.min(text.length + 2, getTerminalWidth() - 4)))}`);
}

export function printRow(label: string, value: string, width = 20): void {
  const paddedLabel = label.padEnd(width);
  console.log(`  ${colors.gray(paddedLabel)} ${value}`);
}

// =============================================================================
// Banner
// =============================================================================

export function printBanner(): void {
  const art = [
    '   ██████╗  █████╗ ███████╗██╗███████╗',
    '  ██╔═══██╗██╔══██╗██╔════╝██║██╔════╝',
    '  ██║   ██║███████║███████╗██║███████╗',
    '  ██║   ██║██╔══██║╚════██║██║╚════██║',
    '  ╚██████╔╝██║  ██║███████║██║███████║',
    '   ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝╚══════╝',
  ];

  console.log();
  for (const line of art) {
    console.log(brandGradient(line));
  }
  console.log();
  console.log(`  ${colors.gray('AI Security Benchmarking')}  ${colors.gray.dim(`v${version}`)}`);
  console.log();
}

// =============================================================================
// Badges
// =============================================================================

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

export function formatCategory(category: string): string {
  return colors.cyan(`[${category}]`);
}
