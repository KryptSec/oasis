// OASIS After-Action Report Generator

import chalk from 'chalk';
import type { RunResult, Step, AttackTechnique, AnalysisResult } from './types.js';

// MITRE ATT&CK Tactic icons
const TACTIC_ICONS: Record<string, string> = {
  'Reconnaissance': '🔍',
  'Resource Development': '🔧',
  'Initial Access': '💥',
  'Execution': '⚡',
  'Persistence': '🔒',
  'Privilege Escalation': '⬆️',
  'Defense Evasion': '🛡️',
  'Credential Access': '🔑',
  'Discovery': '🔎',
  'Lateral Movement': '↔️',
  'Collection': '📤',
  'Command and Control': '📡',
  'Exfiltration': '📦',
  'Impact': '💣',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : ' '.repeat(len - str.length) + str;
}

function truncate(str: string, len: number): string {
  return str.length <= len ? str : str.substring(0, len - 3) + '...';
}

function getTechniqueDisplay(technique: AttackTechnique | null | undefined): string {
  if (!technique) return 'UNKNOWN';
  return technique.id;
}

export function generateTextReport(result: RunResult): string {
  const width = 80;
  const divider = '═'.repeat(width);
  const thinDivider = '─'.repeat(width);

  let report = '';

  // Header
  report += `╔${divider}╗\n`;
  report += `║${padRight('                       OASIS AFTER-ACTION REPORT', width)}║\n`;
  report += `║${padRight('                     MITRE ATT&CK Classification', width)}║\n`;
  report += `╠${divider}╣\n`;

  // Basic info
  report += `║ ${padRight(`Run ID: ${result.id}`, width - 2)} ║\n`;
  report += `║ ${padRight(`Model: ${result.modelVersion}`, 38)}${padRight(`Challenge: ${result.challenge}`, width - 40)} ║\n`;
  report += `║ ${padRight(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`, 38)}${padRight(`Flag: ${result.flag || 'NOT FOUND'}`, width - 40)} ║\n`;

  // Metrics
  report += `╠${divider}╣\n`;
  report += `║${padRight('                           METRICS', width)}║\n`;
  report += `╠${divider}╣\n`;
  report += `║ ${padRight(`Total Time: ${result.totalTime.toFixed(1)}s`, 38)}${padRight(`Iterations: ${result.iterations}`, width - 40)} ║\n`;
  report += `║ ${padRight(`Input Tokens: ${result.tokens.input.toLocaleString()}`, 38)}${padRight(`Output Tokens: ${result.tokens.output.toLocaleString()}`, width - 40)} ║\n`;

  const estimatedCost = ((result.tokens.input * 0.003 + result.tokens.output * 0.015) / 1000).toFixed(3);
  report += `║ ${padRight(`Total Tokens: ${result.tokens.total.toLocaleString()}`, 38)}${padRight(`Est. Cost: ~$${estimatedCost}`, width - 40)} ║\n`;

  // Techniques Used
  report += `╠${divider}╣\n`;
  report += `║${padRight('                    ATT&CK TECHNIQUES USED', width)}║\n`;
  report += `╠${divider}╣\n`;

  if (result.techniquesUsed && result.techniquesUsed.length > 0) {
    for (const tech of result.techniquesUsed) {
      const icon = TACTIC_ICONS[tech.tactic] || '❓';
      report += `║ ${icon} ${padRight(`${tech.id}: ${tech.name}`, width - 5)} ║\n`;
    }
  } else {
    report += `║ ${padRight('No ATT&CK techniques detected', width - 2)} ║\n`;
  }

  // Attack Path with Technique IDs
  report += `╠${divider}╣\n`;
  report += `║${padRight('                      ATTACK PATH (ATT&CK)', width)}║\n`;
  report += `╠${divider}╣\n`;

  let cumulativeTime = 0;
  for (const step of result.steps) {
    if (step.type === 'tool_call' && step.command) {
      const timeStr = formatDuration(cumulativeTime);
      const techId = getTechniqueDisplay(step.technique);
      const command = truncate(step.command, 42);
      const successMark = step.success ? '✓' : '✗';
      const icon = step.technique ? (TACTIC_ICONS[step.technique.tactic] || '❓') : '❓';

      report += `║ [${padLeft(step.iteration.toString(), 2)}] ${icon} ${padRight(techId, 10)} ${padRight(command, 42)} ${padLeft(timeStr, 6)} ${successMark} ║\n`;
      cumulativeTime += step.duration;
    }
  }

  // Tactic Breakdown
  report += `╠${divider}╣\n`;
  report += `║${padRight('                     TACTIC BREAKDOWN', width)}║\n`;
  report += `╠${divider}╣\n`;

  if (result.tacticBreakdown && Object.keys(result.tacticBreakdown).length > 0) {
    for (const [tactic, stats] of Object.entries(result.tacticBreakdown)) {
      const bar = '█'.repeat(Math.floor(stats.percentage / 5)) + '░'.repeat(20 - Math.floor(stats.percentage / 5));
      const icon = TACTIC_ICONS[tactic] || '❓';
      const techList = stats.techniques.join(', ');
      report += `║ ${icon} ${padRight(tactic + ':', 20)} ${padLeft(stats.count.toString(), 2)} (${padLeft(stats.percentage.toFixed(0), 3)}%) ${bar} ║\n`;
      report += `║   ${padRight(`[${techList}]`, width - 5)} ║\n`;
    }
  } else {
    // Fallback to legacy methodology breakdown
    for (const [methodology, stats] of Object.entries(result.methodologyBreakdown)) {
      const bar = '█'.repeat(Math.floor(stats.percentage / 5)) + '░'.repeat(20 - Math.floor(stats.percentage / 5));
      report += `║ ${padRight(methodology + ':', 22)} ${padLeft(stats.count.toString(), 2)} steps (${padLeft(stats.percentage.toFixed(1), 5)}%) ${bar} ║\n`;
    }
  }

  // Tools Used
  report += `╠${divider}╣\n`;
  report += `║${padRight('                        TOOLS USED', width)}║\n`;
  report += `╠${divider}╣\n`;

  const toolCounts: Record<string, number> = {};
  for (const step of result.steps) {
    if (step.tool) {
      toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
    }
  }

  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    report += `║ ${padRight(`${tool}: ${count} invocation${count > 1 ? 's' : ''}`, width - 2)} ║\n`;
  }

  // Footer
  report += `╚${divider}╝\n`;

  return report;
}

export function printColorReport(result: RunResult): void {
  const width = 80;

  console.log(chalk.cyan.bold('\n' + '═'.repeat(width)));
  console.log(chalk.cyan.bold('                    OASIS AFTER-ACTION REPORT'));
  console.log(chalk.cyan.bold('                   MITRE ATT&CK Classification'));
  console.log(chalk.cyan.bold('═'.repeat(width)));

  console.log(chalk.white(`Run ID: ${chalk.yellow(result.id)}`));
  console.log(chalk.white(`Model: ${chalk.cyan(result.modelVersion)}    Challenge: ${chalk.magenta(result.challenge)}`));

  if (result.success) {
    console.log(chalk.green.bold(`Result: SUCCESS    Flag: ${result.flag}`));
  } else {
    console.log(chalk.red.bold(`Result: FAILED    Flag: NOT FOUND`));
  }

  console.log(chalk.cyan('\n─── METRICS ───'));
  console.log(chalk.white(`Total Time: ${chalk.yellow(result.totalTime.toFixed(1) + 's')}    Iterations: ${chalk.yellow(result.iterations.toString())}`));
  console.log(chalk.white(`Tokens: ${chalk.cyan(result.tokens.input.toLocaleString())} in / ${chalk.cyan(result.tokens.output.toLocaleString())} out / ${chalk.cyan(result.tokens.total.toLocaleString())} total`));

  const estimatedCost = ((result.tokens.input * 0.003 + result.tokens.output * 0.015) / 1000).toFixed(3);
  console.log(chalk.white(`Estimated Cost: ${chalk.green('~$' + estimatedCost)}`));

  // Techniques Used
  console.log(chalk.cyan('\n─── ATT&CK TECHNIQUES ───'));

  if (result.techniquesUsed && result.techniquesUsed.length > 0) {
    for (const tech of result.techniquesUsed) {
      const icon = TACTIC_ICONS[tech.tactic] || '❓';
      console.log(`${icon} ${chalk.yellow(tech.id)}: ${chalk.white(tech.name)} ${chalk.gray(`(${tech.tactic})`)}`);
    }
  } else {
    console.log(chalk.gray('No ATT&CK techniques detected'));
  }

  console.log(chalk.cyan('\n─── ATTACK PATH (ATT&CK) ───'));

  let cumulativeTime = 0;
  for (const step of result.steps) {
    if (step.type === 'tool_call' && step.command) {
      const timeStr = formatDuration(cumulativeTime).padStart(6);
      const techId = getTechniqueDisplay(step.technique).padEnd(10);
      const command = truncate(step.command, 45);
      const iterStr = step.iteration.toString().padStart(2);
      const icon = step.technique ? (TACTIC_ICONS[step.technique.tactic] || '❓') : '❓';

      // Color based on tactic
      let techColor = chalk.gray;
      if (step.technique) {
        switch (step.technique.tactic) {
          case 'Reconnaissance': techColor = chalk.blue; break;
          case 'Initial Access': techColor = chalk.red; break;
          case 'Credential Access': techColor = chalk.yellow; break;
          case 'Privilege Escalation': techColor = chalk.magenta; break;
          case 'Collection': techColor = chalk.green; break;
          case 'Defense Evasion': techColor = chalk.cyan; break;
          case 'Discovery': techColor = chalk.blueBright; break;
        }
      }

      const successMark = step.success ? chalk.green('✓') : chalk.red('✗');

      console.log(`[${chalk.cyan(iterStr)}] ${icon} ${techColor(techId)} ${chalk.white(command)} ${chalk.gray(timeStr)} ${successMark}`);
      cumulativeTime += step.duration;
    }
  }

  // Tactic Breakdown
  console.log(chalk.cyan('\n─── TACTIC BREAKDOWN ───'));

  if (result.tacticBreakdown && Object.keys(result.tacticBreakdown).length > 0) {
    for (const [tactic, stats] of Object.entries(result.tacticBreakdown)) {
      const icon = TACTIC_ICONS[tactic] || '❓';
      const bar = chalk.green('█'.repeat(Math.floor(stats.percentage / 5))) +
                  chalk.gray('░'.repeat(20 - Math.floor(stats.percentage / 5)));
      console.log(`${icon} ${tactic.padEnd(20)} ${stats.count.toString().padStart(2)} steps (${stats.percentage.toFixed(0).padStart(3)}%) ${bar}`);
      console.log(chalk.gray(`   [${stats.techniques.join(', ')}]`));
    }
  } else {
    // Fallback to legacy methodology breakdown
    for (const [methodology, stats] of Object.entries(result.methodologyBreakdown)) {
      const bar = chalk.green('█'.repeat(Math.floor(stats.percentage / 5))) +
                  chalk.gray('░'.repeat(20 - Math.floor(stats.percentage / 5)));
      console.log(`${methodology.padEnd(22)} ${stats.count.toString().padStart(2)} steps (${stats.percentage.toFixed(1).padStart(5)}%) ${bar}`);
    }
  }

  console.log(chalk.cyan('\n─── TOOLS USED ───'));

  const toolCounts: Record<string, number> = {};
  for (const step of result.steps) {
    if (step.tool) {
      toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
    }
  }

  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(chalk.white(`${tool}: ${chalk.yellow(count)} invocation${count > 1 ? 's' : ''}`));
  }

  console.log(chalk.cyan.bold('\n' + '═'.repeat(width) + '\n'));
}

export function generateTimelineVisualization(result: RunResult): string {
  // Horizontal timeline overview with ATT&CK technique IDs
  let timeline = '\nATTACK TIMELINE (ATT&CK):\n';

  let line1 = '';  // Icons
  let line2 = '';  // Technique IDs
  let line3 = '';  // Arrows
  let line4 = '';  // Time

  let cumulativeTime = 0;
  for (const step of result.steps) {
    if (step.type === 'tool_call') {
      const icon = step.technique ? (TACTIC_ICONS[step.technique.tactic] || '❓') : '❓';
      const techId = step.technique ? step.technique.id : 'UNK';

      line1 += `  ${icon}  `;
      line2 += techId.padStart(5) + ' ';
      line3 += ' ──> ';
      line4 += formatDuration(cumulativeTime).padStart(5) + ' ';
      cumulativeTime += step.duration;
    }
  }

  timeline += line1 + '\n';
  timeline += line2 + '\n';
  timeline += line3.slice(0, -2) + (result.success ? ' 🚩' : ' ❌') + '\n';
  timeline += line4 + '\n';

  return timeline;
}

// =============================================================================
// Enterprise Analysis Report
// =============================================================================

function getScoreColor(score: number): typeof chalk {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  if (score >= 40) return chalk.hex('#FFA500'); // orange
  return chalk.red;
}

function renderScoreBar(score: number, width: number = 20): string {
  const filled = Math.floor((score / 100) * width);
  const empty = width - filled;
  const color = getScoreColor(score);
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

export function printAnalysisSummary(analysis: AnalysisResult): void {
  const width = 80;

  console.log(chalk.magenta.bold('\n' + '═'.repeat(width)));
  console.log(chalk.magenta.bold('                    ENTERPRISE ATTACK ANALYSIS'));
  console.log(chalk.magenta.bold('                      Powered by Claude Sonnet'));
  console.log(chalk.magenta.bold('═'.repeat(width)));

  // Executive Summary
  console.log(chalk.cyan('\n─── EXECUTIVE SUMMARY ───'));
  console.log(chalk.white(analysis.narrative.summary));

  // Key Findings
  console.log(chalk.cyan('\n─── KEY FINDINGS ───'));
  for (const finding of analysis.narrative.keyFindings) {
    console.log(chalk.white(`  • ${finding}`));
  }

  // Strategy Scores
  console.log(chalk.cyan('\n─── STRATEGY ASSESSMENT ───'));

  const scores = [
    { name: 'Recon Quality', score: analysis.strategy.reconQuality },
    { name: 'Exploit Efficiency', score: analysis.strategy.exploitEfficiency },
    { name: 'Adaptability', score: analysis.strategy.adaptability },
    { name: 'Decision Quality', score: analysis.behavior.decisionQuality },
  ];

  for (const { name, score } of scores) {
    const scoreColor = getScoreColor(score);
    console.log(`  ${name.padEnd(20)} ${renderScoreBar(score)} ${scoreColor(score.toString().padStart(3))}/100`);
  }

  console.log(chalk.cyan('\n─── OVERALL SCORE ───'));
  const overall = analysis.strategy.overallScore;
  const overallColor = getScoreColor(overall);
  console.log(`  ${overallColor.bold(overall.toString())}${chalk.gray('/100')} ${renderScoreBar(overall, 30)}`);
  console.log(chalk.gray(`  ${analysis.strategy.scoreBreakdown}`));

  // Behavioral Analysis
  console.log(chalk.cyan('\n─── BEHAVIORAL ANALYSIS ───'));
  const approachColors: Record<string, typeof chalk> = {
    'methodical': chalk.green,
    'aggressive': chalk.red,
    'exploratory': chalk.yellow,
    'targeted': chalk.cyan,
  };
  const approachColor = approachColors[analysis.behavior.approach] || chalk.white;
  console.log(`  Approach: ${approachColor.bold(analysis.behavior.approach.toUpperCase())}`);
  console.log(chalk.gray(`  ${analysis.behavior.approachDescription}`));

  console.log(chalk.green('\n  Strengths:'));
  for (const strength of analysis.behavior.strengths) {
    console.log(chalk.green(`    ✓ ${strength}`));
  }

  if (analysis.behavior.inefficiencies.length > 0) {
    console.log(chalk.yellow('\n  Inefficiencies:'));
    for (const inefficiency of analysis.behavior.inefficiencies) {
      console.log(chalk.yellow(`    ⚠ ${inefficiency}`));
    }
  }

  // Attack Chain Phases
  console.log(chalk.cyan('\n─── ATTACK CHAIN PHASES ───'));
  for (const phase of analysis.attackChain.phases) {
    const icon = TACTIC_ICONS[phase.phase] || '❓';
    console.log(`  ${icon} ${chalk.white.bold(phase.phase)} ${chalk.gray(`(Steps ${phase.stepRange[0]}-${phase.stepRange[1]})`)}`);
    console.log(chalk.gray(`     ${phase.description}`));
    if (phase.techniques.length > 0) {
      console.log(chalk.yellow(`     Techniques: ${phase.techniques.join(', ')}`));
    }
  }

  // Kill Chain Coverage
  console.log(chalk.cyan('\n─── KILL CHAIN COVERAGE ───'));
  const allPhases = ['Reconnaissance', 'Initial Access', 'Execution', 'Persistence',
                     'Privilege Escalation', 'Defense Evasion', 'Credential Access',
                     'Discovery', 'Lateral Movement', 'Collection', 'Exfiltration', 'Impact'];

  const covered = new Set(analysis.attackChain.killChainCoverage);
  let coverageDisplay = '';
  for (const phase of allPhases) {
    const icon = TACTIC_ICONS[phase] || '❓';
    if (covered.has(phase)) {
      coverageDisplay += chalk.green(`${icon} `);
    } else {
      coverageDisplay += chalk.gray(`${icon} `);
    }
  }
  console.log(`  ${coverageDisplay}`);
  console.log(chalk.gray(`  Coverage: ${covered.size}/${allPhases.length} phases`));

  // Detailed Narrative (collapsible in real UI, full here)
  console.log(chalk.cyan('\n─── DETAILED NARRATIVE ───'));
  const narrativeLines = analysis.narrative.detailed.split('. ');
  for (const line of narrativeLines) {
    if (line.trim()) {
      console.log(chalk.white(`  ${line.trim()}.`));
    }
  }

  console.log(chalk.magenta.bold('\n' + '═'.repeat(width)));
  console.log(chalk.gray(`  Analyzed at: ${analysis.analyzedAt}`));
  console.log(chalk.gray(`  Analyzer: ${analysis.analyzerModel}`));
  console.log(chalk.magenta.bold('═'.repeat(width) + '\n'));
}

export function generateAnalysisTextReport(analysis: AnalysisResult): string {
  const width = 80;
  const divider = '═'.repeat(width);

  let report = '';

  report += `╔${divider}╗\n`;
  report += `║${padRight('                    ENTERPRISE ATTACK ANALYSIS', width)}║\n`;
  report += `║${padRight('                      Powered by Claude Sonnet', width)}║\n`;
  report += `╠${divider}╣\n`;

  report += `║ ${padRight('EXECUTIVE SUMMARY', width - 2)} ║\n`;
  report += `║ ${padRight(analysis.narrative.summary, width - 2)} ║\n`;
  report += `╠${divider}╣\n`;

  report += `║ ${padRight('KEY FINDINGS', width - 2)} ║\n`;
  for (const finding of analysis.narrative.keyFindings) {
    report += `║  • ${padRight(finding, width - 5)} ║\n`;
  }
  report += `╠${divider}╣\n`;

  report += `║ ${padRight('STRATEGY SCORES', width - 2)} ║\n`;
  report += `║  ${padRight(`Recon Quality: ${analysis.strategy.reconQuality}/100`, width - 4)} ║\n`;
  report += `║  ${padRight(`Exploit Efficiency: ${analysis.strategy.exploitEfficiency}/100`, width - 4)} ║\n`;
  report += `║  ${padRight(`Adaptability: ${analysis.strategy.adaptability}/100`, width - 4)} ║\n`;
  report += `║  ${padRight(`Decision Quality: ${analysis.behavior.decisionQuality}/100`, width - 4)} ║\n`;
  report += `║  ${padRight(`OVERALL: ${analysis.strategy.overallScore}/100`, width - 4)} ║\n`;
  report += `╠${divider}╣\n`;

  report += `║ ${padRight(`BEHAVIORAL APPROACH: ${analysis.behavior.approach.toUpperCase()}`, width - 2)} ║\n`;
  report += `║  ${padRight(analysis.behavior.approachDescription, width - 4)} ║\n`;
  report += `╠${divider}╣\n`;

  report += `║ ${padRight('ATTACK CHAIN PHASES', width - 2)} ║\n`;
  for (const phase of analysis.attackChain.phases) {
    report += `║  ${padRight(`${phase.phase} (Steps ${phase.stepRange[0]}-${phase.stepRange[1]})`, width - 4)} ║\n`;
    report += `║    ${padRight(phase.description, width - 6)} ║\n`;
  }

  report += `╚${divider}╝\n`;

  return report;
}
