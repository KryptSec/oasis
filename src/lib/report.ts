// OASIS Report Generator
// Supports terminal (colored), text, JSON, and markdown output formats

import chalk from 'chalk';
import type { RunResult, AttackTechnique, AnalysisResult } from './types.js';

// MITRE ATT&CK Tactic icons
const TACTIC_ICONS: Record<string, string> = {
  'Reconnaissance': '🔍', 'Resource Development': '🔧', 'Initial Access': '💥',
  'Execution': '⚡', 'Persistence': '🔒', 'Privilege Escalation': '⬆️',
  'Defense Evasion': '🛡️', 'Credential Access': '🔑', 'Discovery': '🔎',
  'Lateral Movement': '↔️', 'Collection': '📤', 'Command and Control': '📡',
  'Exfiltration': '📦', 'Impact': '💣',
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

function truncateStr(str: string, len: number): string {
  return str.length <= len ? str : str.substring(0, len - 3) + '...';
}

function getTechniqueDisplay(technique: AttackTechnique | null | undefined): string {
  return technique ? technique.id : 'UNKNOWN';
}

// =============================================================================
// Text Report (box-drawing)
// =============================================================================

export function generateTextReport(result: RunResult): string {
  const width = 80;
  const divider = '═'.repeat(width);
  let report = '';

  report += `╔${divider}╗\n`;
  report += `║${padRight('                       OASIS AFTER-ACTION REPORT', width)}║\n`;
  report += `╠${divider}╣\n`;

  report += `║ ${padRight(`Run ID: ${result.id}`, width - 2)} ║\n`;
  report += `║ ${padRight(`Model: ${result.modelVersion}`, 38)}${padRight(`Challenge: ${result.challenge}`, width - 40)} ║\n`;
  report += `║ ${padRight(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`, 38)}${padRight(`Flag: ${result.flag || 'NOT FOUND'}`, width - 40)} ║\n`;

  report += `╠${divider}╣\n`;
  report += `║${padRight('                           METRICS', width)}║\n`;
  report += `╠${divider}╣\n`;
  report += `║ ${padRight(`Total Time: ${result.totalTime.toFixed(1)}s`, 38)}${padRight(`Iterations: ${result.iterations}`, width - 40)} ║\n`;
  report += `║ ${padRight(`Input Tokens: ${result.tokens.input.toLocaleString()}`, 38)}${padRight(`Output Tokens: ${result.tokens.output.toLocaleString()}`, width - 40)} ║\n`;
  report += `║ ${padRight(`Total Tokens: ${result.tokens.total.toLocaleString()}`, width - 2)} ║\n`;

  // Techniques
  report += `╠${divider}╣\n`;
  report += `║${padRight('                    ATT&CK TECHNIQUES USED', width)}║\n`;
  report += `╠${divider}╣\n`;
  if (result.techniquesUsed?.length > 0) {
    for (const tech of result.techniquesUsed) {
      const icon = TACTIC_ICONS[tech.tactic] || '?';
      report += `║ ${icon} ${padRight(`${tech.id}: ${tech.name}`, width - 5)} ║\n`;
    }
  } else {
    report += `║ ${padRight('No ATT&CK techniques detected (run analysis to populate)', width - 2)} ║\n`;
  }

  // Attack Path
  report += `╠${divider}╣\n`;
  report += `║${padRight('                      ATTACK PATH', width)}║\n`;
  report += `╠${divider}╣\n`;
  let cumulativeTime = 0;
  for (const step of result.steps) {
    if (step.type === 'tool_call' && step.command) {
      const timeStr = formatDuration(cumulativeTime);
      const techId = getTechniqueDisplay(step.technique);
      const command = truncateStr(step.command, 42);
      const successMark = step.success ? '✓' : '✗';
      report += `║ [${padLeft(step.iteration.toString(), 2)}] ${padRight(techId, 10)} ${padRight(command, 42)} ${padLeft(timeStr, 6)} ${successMark} ║\n`;
      cumulativeTime += step.duration;
    }
  }

  // Tools
  report += `╠${divider}╣\n`;
  report += `║${padRight('                        TOOLS USED', width)}║\n`;
  report += `╠${divider}╣\n`;
  const toolCounts: Record<string, number> = {};
  for (const step of result.steps) {
    if (step.tool) toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
  }
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    report += `║ ${padRight(`${tool}: ${count} invocation${count > 1 ? 's' : ''}`, width - 2)} ║\n`;
  }

  report += `╚${divider}╝\n`;
  return report;
}

// =============================================================================
// Colored Terminal Report
// =============================================================================

export function printColorReport(result: RunResult): void {
  const width = 80;

  console.log(chalk.cyan.bold('\n' + '═'.repeat(width)));
  console.log(chalk.cyan.bold('                    OASIS AFTER-ACTION REPORT'));
  console.log(chalk.cyan.bold('═'.repeat(width)));

  console.log(chalk.white(`Run ID: ${chalk.yellow(result.id)}`));
  console.log(chalk.white(`Model: ${chalk.cyan(result.modelVersion)}    Challenge: ${chalk.magenta(result.challenge)}`));
  console.log(result.success ? chalk.green.bold(`Result: SUCCESS    Flag: ${result.flag}`) : chalk.red.bold(`Result: FAILED    Flag: NOT FOUND`));

  console.log(chalk.cyan('\n─── METRICS ───'));
  console.log(chalk.white(`Total Time: ${chalk.yellow(result.totalTime.toFixed(1) + 's')}    Iterations: ${chalk.yellow(result.iterations.toString())}`));
  console.log(chalk.white(`Tokens: ${chalk.cyan(result.tokens.input.toLocaleString())} in / ${chalk.cyan(result.tokens.output.toLocaleString())} out / ${chalk.cyan(result.tokens.total.toLocaleString())} total`));

  console.log(chalk.cyan('\n─── ATT&CK TECHNIQUES ───'));
  if (result.techniquesUsed?.length > 0) {
    for (const tech of result.techniquesUsed) {
      const icon = TACTIC_ICONS[tech.tactic] || '?';
      console.log(`${icon} ${chalk.yellow(tech.id)}: ${chalk.white(tech.name)} ${chalk.gray(`(${tech.tactic})`)}`);
    }
  } else {
    console.log(chalk.gray('No ATT&CK techniques detected (run analysis to populate)'));
  }

  console.log(chalk.cyan('\n─── ATTACK PATH ───'));
  let cumulativeTime = 0;
  for (const step of result.steps) {
    if (step.type === 'tool_call' && step.command) {
      const timeStr = formatDuration(cumulativeTime).padStart(6);
      const techId = getTechniqueDisplay(step.technique).padEnd(10);
      const command = truncateStr(step.command, 45);
      const iterStr = step.iteration.toString().padStart(2);
      const successMark = step.success ? chalk.green('✓') : chalk.red('✗');
      console.log(`[${chalk.cyan(iterStr)}] ${chalk.gray(techId)} ${chalk.white(command)} ${chalk.gray(timeStr)} ${successMark}`);
      cumulativeTime += step.duration;
    }
  }

  console.log(chalk.cyan('\n─── TOOLS USED ───'));
  const toolCounts: Record<string, number> = {};
  for (const step of result.steps) {
    if (step.tool) toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
  }
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(chalk.white(`${tool}: ${chalk.yellow(count)} invocation${count > 1 ? 's' : ''}`));
  }

  console.log(chalk.cyan.bold('\n' + '═'.repeat(width) + '\n'));
}

// =============================================================================
// Timeline Visualization
// =============================================================================

export function generateTimelineVisualization(result: RunResult): string {
  let timeline = '\nATTACK TIMELINE:\n';
  let line1 = '', line2 = '', line3 = '';
  let cumulativeTime = 0;

  for (const step of result.steps) {
    if (step.type === 'tool_call') {
      const icon = step.technique ? (TACTIC_ICONS[step.technique.tactic] || '?') : '?';
      const techId = step.technique ? step.technique.id : 'UNK';
      line1 += `  ${icon}  `;
      line2 += techId.padStart(5) + ' ';
      line3 += formatDuration(cumulativeTime).padStart(5) + ' ';
      cumulativeTime += step.duration;
    }
  }

  timeline += line1 + '\n' + line2 + '\n' + line3 + '\n';
  return timeline;
}

// =============================================================================
// Analysis Report (terminal)
// =============================================================================

function getScoreColor(score: number): typeof chalk {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  if (score >= 40) return chalk.hex('#FFA500');
  return chalk.red;
}

function renderScoreBar(score: number, width: number = 20): string {
  const filled = Math.floor((score / 100) * width);
  const empty = width - filled;
  return getScoreColor(score)('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

export function printAnalysisSummary(analysis: AnalysisResult): void {
  const width = 80;

  console.log(chalk.magenta.bold('\n' + '═'.repeat(width)));
  console.log(chalk.magenta.bold('                       ATTACK ANALYSIS'));
  console.log(chalk.magenta.bold('═'.repeat(width)));

  console.log(chalk.cyan('\n─── EXECUTIVE SUMMARY ───'));
  console.log(chalk.white(analysis.narrative.summary));

  console.log(chalk.cyan('\n─── KEY FINDINGS ───'));
  for (const finding of analysis.narrative.keyFindings) {
    console.log(chalk.white(`  • ${finding}`));
  }

  console.log(chalk.cyan('\n─── STRATEGY ASSESSMENT ───'));
  const scores = [
    { name: 'Recon Quality', score: analysis.strategy.reconQuality },
    { name: 'Exploit Efficiency', score: analysis.strategy.exploitEfficiency },
    { name: 'Adaptability', score: analysis.strategy.adaptability },
    { name: 'Decision Quality', score: analysis.behavior.decisionQuality },
  ];
  for (const { name, score } of scores) {
    console.log(`  ${name.padEnd(20)} ${renderScoreBar(score)} ${getScoreColor(score)(score.toString().padStart(3))}/100`);
  }

  console.log(chalk.cyan('\n─── OVERALL SCORE ───'));
  const overall = analysis.strategy.overallScore;
  console.log(`  ${getScoreColor(overall).bold(overall.toString())}${chalk.gray('/100')} ${renderScoreBar(overall, 30)}`);

  // Behavioral
  console.log(chalk.cyan('\n─── BEHAVIORAL ANALYSIS ───'));
  const approachColors: Record<string, typeof chalk> = {
    methodical: chalk.green, aggressive: chalk.red, exploratory: chalk.yellow, targeted: chalk.cyan,
  };
  const approachColor = approachColors[analysis.behavior.approach] || chalk.white;
  console.log(`  Approach: ${approachColor.bold(analysis.behavior.approach.toUpperCase())}`);
  console.log(chalk.gray(`  ${analysis.behavior.approachDescription}`));

  if (analysis.behavior.strengths.length > 0) {
    console.log(chalk.green('\n  Strengths:'));
    for (const s of analysis.behavior.strengths) console.log(chalk.green(`    ✓ ${s}`));
  }
  if (analysis.behavior.inefficiencies.length > 0) {
    console.log(chalk.yellow('\n  Inefficiencies:'));
    for (const i of analysis.behavior.inefficiencies) console.log(chalk.yellow(`    ⚠ ${i}`));
  }

  // Attack Phases
  console.log(chalk.cyan('\n─── ATTACK CHAIN PHASES ───'));
  for (const phase of analysis.attackChain.phases) {
    const icon = TACTIC_ICONS[phase.phase] || '?';
    console.log(`  ${icon} ${chalk.white.bold(phase.phase)} ${chalk.gray(`(Steps ${phase.stepRange[0]}-${phase.stepRange[1]})`)}`);
    console.log(chalk.gray(`     ${phase.description}`));
    if (phase.techniques.length > 0) {
      console.log(chalk.yellow(`     Techniques: ${phase.techniques.join(', ')}`));
    }
  }

  console.log(chalk.magenta.bold('\n' + '═'.repeat(width)));
  console.log(chalk.gray(`  Analyzed at: ${analysis.analyzedAt}`));
  console.log(chalk.gray(`  Analyzer: ${analysis.analyzerModel}`));
  console.log(chalk.magenta.bold('═'.repeat(width) + '\n'));
}

// =============================================================================
// Analysis Text Report
// =============================================================================

export function generateAnalysisTextReport(analysis: AnalysisResult): string {
  const width = 80;
  const divider = '═'.repeat(width);
  let report = '';

  report += `╔${divider}╗\n`;
  report += `║${padRight('                       ATTACK ANALYSIS', width)}║\n`;
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
  report += `║  ${padRight(`OVERALL: ${analysis.strategy.overallScore}/100`, width - 4)} ║\n`;
  report += `╠${divider}╣\n`;

  report += `║ ${padRight(`BEHAVIORAL APPROACH: ${analysis.behavior.approach.toUpperCase()}`, width - 2)} ║\n`;
  report += `╠${divider}╣\n`;

  report += `║ ${padRight('ATTACK CHAIN PHASES', width - 2)} ║\n`;
  for (const phase of analysis.attackChain.phases) {
    report += `║  ${padRight(`${phase.phase} (Steps ${phase.stepRange[0]}-${phase.stepRange[1]})`, width - 4)} ║\n`;
    report += `║    ${padRight(phase.description, width - 6)} ║\n`;
  }

  report += `╚${divider}╝\n`;
  return report;
}

// =============================================================================
// JSON Report
// =============================================================================

export function generateJsonReport(result: RunResult, analysis?: AnalysisResult): string {
  const report: any = {
    metadata: {
      runId: result.id,
      model: result.modelVersion,
      provider: result.model,
      challenge: result.challenge,
      startTime: result.startTime,
      endTime: result.endTime,
    },
    result: {
      success: result.success,
      flag: result.flag,
      totalTime: result.totalTime,
      iterations: result.iterations,
      tokens: result.tokens,
    },
    techniques: result.techniquesUsed,
    tacticBreakdown: result.tacticBreakdown,
    toolsUsed: result.toolsUsed,
    steps: result.steps.filter(s => s.type === 'tool_call').map(s => ({
      iteration: s.iteration,
      command: s.command,
      tool: s.tool,
      success: s.success,
      duration: s.duration,
      technique: s.technique?.id || null,
      reasoning: s.reasoning?.substring(0, 200) || null,
    })),
  };

  if (analysis) {
    report.analysis = {
      overallScore: analysis.strategy.overallScore,
      approach: analysis.behavior.approach,
      narrative: analysis.narrative.summary,
      keyFindings: analysis.narrative.keyFindings,
      strategy: analysis.strategy,
      behavior: analysis.behavior,
      attackChain: analysis.attackChain,
      rubricScore: analysis.rubricScore || null,
    };
  }

  return JSON.stringify(report, null, 2);
}

// =============================================================================
// Markdown Report
// =============================================================================

export function generateMarkdownReport(result: RunResult, analysis?: AnalysisResult): string {
  let md = '';

  md += `# OASIS Benchmark Report\n\n`;
  md += `## Run Summary\n\n`;
  md += `| Field | Value |\n|---|---|\n`;
  md += `| Run ID | \`${result.id}\` |\n`;
  md += `| Model | ${result.modelVersion} |\n`;
  md += `| Provider | ${result.model} |\n`;
  md += `| Challenge | ${result.challenge} |\n`;
  md += `| Result | ${result.success ? '**SUCCESS**' : 'FAILED'} |\n`;
  md += `| Flag | ${result.flag ? `\`${result.flag}\`` : 'Not found'} |\n`;
  md += `| Duration | ${result.totalTime.toFixed(1)}s |\n`;
  md += `| Iterations | ${result.iterations} |\n`;
  md += `| Total Tokens | ${result.tokens.total.toLocaleString()} |\n\n`;

  // Techniques
  if (result.techniquesUsed?.length > 0) {
    md += `## MITRE ATT&CK Techniques\n\n`;
    md += `| Technique | Name | Tactic |\n|---|---|---|\n`;
    for (const tech of result.techniquesUsed) {
      md += `| [${tech.id}](${tech.url}) | ${tech.name} | ${tech.tactic} |\n`;
    }
    md += '\n';
  }

  // Attack Path
  md += `## Attack Path\n\n`;
  md += `| Step | Command | Tool | Success | Duration |\n|---|---|---|---|---|\n`;
  let cumulativeTime = 0;
  for (const step of result.steps) {
    if (step.type === 'tool_call' && step.command) {
      const cmd = step.command.length > 50 ? step.command.substring(0, 47) + '...' : step.command;
      md += `| ${step.iteration} | \`${cmd}\` | ${step.tool || '-'} | ${step.success ? 'Yes' : 'No'} | ${formatDuration(cumulativeTime)} |\n`;
      cumulativeTime += step.duration;
    }
  }
  md += '\n';

  // Tools
  md += `## Tools Used\n\n`;
  const toolCounts: Record<string, number> = {};
  for (const step of result.steps) {
    if (step.tool) toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
  }
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    md += `- **${tool}**: ${count} invocation${count > 1 ? 's' : ''}\n`;
  }
  md += '\n';

  // Analysis
  if (analysis) {
    md += `## Analysis\n\n`;
    md += `**Overall Score:** ${analysis.strategy.overallScore}/100\n\n`;
    md += `### Executive Summary\n\n${analysis.narrative.summary}\n\n`;

    md += `### Key Findings\n\n`;
    for (const finding of analysis.narrative.keyFindings) {
      md += `- ${finding}\n`;
    }
    md += '\n';

    md += `### Strategy Scores\n\n`;
    md += `| Category | Score |\n|---|---|\n`;
    md += `| Recon Quality | ${analysis.strategy.reconQuality}/100 |\n`;
    md += `| Exploit Efficiency | ${analysis.strategy.exploitEfficiency}/100 |\n`;
    md += `| Adaptability | ${analysis.strategy.adaptability}/100 |\n`;
    md += `| Decision Quality | ${analysis.behavior.decisionQuality}/100 |\n\n`;

    md += `### Behavioral Analysis\n\n`;
    md += `**Approach:** ${analysis.behavior.approach}\n\n`;
    md += `${analysis.behavior.approachDescription}\n\n`;

    if (analysis.behavior.strengths.length > 0) {
      md += `**Strengths:**\n`;
      for (const s of analysis.behavior.strengths) md += `- ${s}\n`;
      md += '\n';
    }

    if (analysis.behavior.inefficiencies.length > 0) {
      md += `**Inefficiencies:**\n`;
      for (const i of analysis.behavior.inefficiencies) md += `- ${i}\n`;
      md += '\n';
    }

    // Rubric score
    if (analysis.rubricScore) {
      md += `### Rubric Score: ${analysis.rubricScore.total}/100\n\n`;
      md += `| Category | Points |\n|---|---|\n`;
      md += `| Objective | ${analysis.rubricScore.objective.subtotal} |\n`;
      md += `| Milestones | ${analysis.rubricScore.milestones.points} |\n`;
      md += `| Qualitative | ${analysis.rubricScore.qualitative.subtotal} |\n`;
      md += `| Penalties | ${analysis.rubricScore.penalties.subtotal} |\n`;
      md += `| **Total** | **${analysis.rubricScore.total}** |\n\n`;
    }
  }

  md += `---\n*Generated by [OASIS](https://github.com/kryptsec/oasis)*\n`;
  return md;
}
