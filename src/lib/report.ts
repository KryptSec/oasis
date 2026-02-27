// OASIS Report Generator
// Supports terminal (colored), text, JSON, and markdown output formats

import Table from 'cli-table3';
import { execSync } from 'child_process';
import type { RunResult, AttackTechnique, AnalysisResult } from './types.js';
import { colors, status, sectionHeader, printBox, divider, renderScoreBar, formatScore } from './display.js';

export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else if (process.platform === 'win32') {
      execSync('clip', { input: text });
    } else {
      try {
        execSync('xclip -selection clipboard', { input: text });
      } catch {
        execSync('xsel --clipboard --input', { input: text });
      }
    }
    return true;
  } catch {
    return false;
  }
}

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
  console.log();
  sectionHeader('OASIS AFTER-ACTION REPORT');

  // Run metadata
  const resultLine = result.success
    ? `${colors.green.bold('SUCCESS')}  Flag: ${colors.green(result.flag || '')}`
    : `${colors.red.bold('FAILED')}   Flag: ${colors.gray('NOT FOUND')}`;

  printBox([
    `  ${colors.gray('Run ID')}      ${colors.yellow(result.id)}`,
    `  ${colors.gray('Model')}       ${colors.cyan(result.modelVersion)}`,
    `  ${colors.gray('Challenge')}   ${colors.purple(result.challenge)}`,
    `  ${colors.gray('Result')}      ${resultLine}`,
  ].join('\n'));

  // Metrics
  sectionHeader('METRICS');
  printBox([
    `  ${colors.gray('Time')}     ${colors.yellow(result.totalTime.toFixed(1) + 's')}       ${colors.gray('Iterations')}  ${colors.yellow(result.iterations.toString())}`,
    `  ${colors.gray('Tokens')}   ${colors.cyan(result.tokens.input.toLocaleString())} in / ${colors.cyan(result.tokens.output.toLocaleString())} out / ${colors.cyan(result.tokens.total.toLocaleString())} total`,
  ].join('\n'));

  // ATT&CK Techniques
  sectionHeader('ATT&CK TECHNIQUES');
  if (result.techniquesUsed?.length > 0) {
    for (const tech of result.techniquesUsed) {
      const icon = TACTIC_ICONS[tech.tactic] || '?';
      console.log(`  ${icon} ${colors.yellow(tech.id)}: ${colors.white(tech.name)} ${colors.gray(`(${tech.tactic})`)}`);
    }
  } else {
    console.log(`  ${colors.gray('No ATT&CK techniques detected (run analysis to populate)')}`);
  }

  // Attack Path
  sectionHeader('ATTACK PATH');
  const toolSteps = result.steps.filter(s => s.type === 'tool_call' && s.command);
  if (toolSteps.length > 0) {
    const table = new Table({
      head: ['#', 'Technique', 'Command', 'Time', ''],
      style: { head: ['cyan'], border: ['gray'] },
    });

    let cumulativeTime = 0;
    for (const step of toolSteps) {
      const timeStr = formatDuration(cumulativeTime);
      const techId = getTechniqueDisplay(step.technique);
      const command = truncateStr(step.command!, 38);
      const mark = step.success ? colors.green('✓') : colors.red('✗');
      table.push([step.iteration.toString(), techId, command, timeStr, mark]);
      cumulativeTime += step.duration;
    }
    console.log(table.toString());
  }

  // Tools Used
  sectionHeader('TOOLS USED');
  const toolCounts: Record<string, number> = {};
  for (const step of result.steps) {
    if (step.tool) toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
  }
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${colors.white(tool)}: ${colors.yellow(count.toString())} invocation${count > 1 ? 's' : ''}`);
  }

  console.log();
  divider();
  console.log();
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

export function printAnalysisSummary(analysis: AnalysisResult): void {
  console.log();
  sectionHeader('ATTACK ANALYSIS');

  // Executive Summary
  sectionHeader('EXECUTIVE SUMMARY');
  printBox(colors.white(analysis.narrative.summary));

  // Key Findings
  sectionHeader('KEY FINDINGS');
  for (const finding of analysis.narrative.keyFindings) {
    console.log(`  ${status.info} ${colors.white(finding)}`);
  }

  // Strategy Assessment
  sectionHeader('STRATEGY ASSESSMENT');
  const scores = [
    { name: 'Recon Quality', score: analysis.strategy.reconQuality },
    { name: 'Exploit Efficiency', score: analysis.strategy.exploitEfficiency },
    { name: 'Adaptability', score: analysis.strategy.adaptability },
    { name: 'Decision Quality', score: analysis.behavior.decisionQuality },
  ];
  for (const { name, score } of scores) {
    console.log(`  ${colors.gray(name.padEnd(20))} ${renderScoreBar(score)}`);
  }

  // Strategy Score — LLM assessment (distinct from KSM)
  sectionHeader('STRATEGY SCORE');
  console.log(colors.gray('  LLM assessment — see KSM for weighted benchmark score'));
  const overall = analysis.strategy.overallScore;
  const bar = renderScoreBar(overall, 30, false);
  printBox([
    '',
    `  ${colors.gray('Strategy')}  ${formatScore(overall)}${colors.gray('/100')}`,
    `  ${bar}`,
    '',
  ].join('\n'));

  // Behavioral Analysis
  sectionHeader('BEHAVIORAL ANALYSIS');
  const approachColors: Record<string, typeof colors.green> = {
    methodical: colors.green, aggressive: colors.red, exploratory: colors.yellow, targeted: colors.cyan,
  };
  const approachColor = approachColors[analysis.behavior.approach] || colors.white;
  console.log(`  ${colors.gray('Approach')}  ${approachColor.bold(analysis.behavior.approach.toUpperCase())}`);
  console.log(`  ${colors.gray(analysis.behavior.approachDescription)}`);

  if (analysis.behavior.strengths.length > 0) {
    console.log();
    for (const s of analysis.behavior.strengths) {
      console.log(`  ${status.success} ${colors.green(s)}`);
    }
  }
  if (analysis.behavior.inefficiencies.length > 0) {
    console.log();
    for (const i of analysis.behavior.inefficiencies) {
      console.log(`  ${status.warning} ${colors.yellow(i)}`);
    }
  }

  // Attack Chain Phases
  sectionHeader('ATTACK CHAIN PHASES');
  for (const phase of analysis.attackChain.phases) {
    const icon = TACTIC_ICONS[phase.phase] || '?';
    console.log(`  ${icon} ${colors.white.bold(phase.phase)} ${colors.gray(`(Steps ${phase.stepRange[0]}-${phase.stepRange[1]})`)}`);
    console.log(`     ${colors.gray(phase.description)}`);
    if (phase.techniques.length > 0) {
      console.log(`     ${colors.yellow(phase.techniques.join(', '))}`);
    }
  }

  // Footer
  console.log();
  divider();
  console.log(`  ${colors.gray(`Analyzed: ${analysis.analyzedAt}  •  Model: ${analysis.analyzerModel}`)}`);
  divider();
  console.log();
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
  report += `║  ${padRight(`STRATEGY OVERALL: ${analysis.strategy.overallScore}/100`, width - 4)} ║\n`;
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
    md += `**Strategy Score:** ${analysis.strategy.overallScore}/100 *(LLM assessment — see KSM for weighted benchmark score)*\n\n`;
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

// =============================================================================
// Share Card (compact markdown for social sharing)
// =============================================================================

export function generateShareCard(
  result: RunResult,
  analysis?: AnalysisResult,
  ksmScore?: number,
): string {
  let md = '';

  // Score header
  const score = ksmScore ?? analysis?.rubricScore?.percentage ?? analysis?.strategy?.overallScore;
  if (score != null && score > 0) {
    const barLen = 25;
    const clampedScore = Math.max(0, Math.min(score, 100));
    const filled = Math.round((clampedScore / 100) * barLen);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barLen - filled);
    md += `## \uD83C\uDFC6 OASIS Benchmark Result\n\n`;
    md += `**KSM Score: ${score.toFixed(1)}** ${bar}\n\n`;
  } else {
    md += `## \uD83C\uDFC6 OASIS Benchmark Result\n\n`;
  }

  // Summary table
  const resultEmoji = result.success ? '\u2705 Flag captured' : '\u274C Failed';
  const mins = Math.floor(result.totalTime / 60);
  const secs = Math.round(result.totalTime % 60);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  md += `| | |\n|---|---|\n`;
  md += `| Challenge | **${result.challenge}** |\n`;
  md += `| Model | ${result.modelVersion} |\n`;
  md += `| Result | ${resultEmoji} |\n`;
  md += `| Time | ${timeStr} |\n`;
  md += `| Steps | ${result.iterations} |\n`;

  // Techniques as compact list
  if (result.techniquesUsed?.length > 0) {
    const techIds = result.techniquesUsed.map(t => t.id).join(', ');
    md += `| Techniques | ${techIds} |\n`;
  }
  md += '\n';

  // Analysis one-liner if available
  if (analysis?.behavior?.approach) {
    md += `> **Approach:** ${analysis.behavior.approach} \u2014 ${analysis.narrative.summary.split('.')[0]}.\n\n`;
  }

  md += `> Benchmarked with [OASIS](https://oasis.kryptsec.com)\n`;
  return md;
}

// =============================================================================
// HTML Report (standalone dark-themed file)
// =============================================================================

export function generateHtmlReport(
  result: RunResult,
  analysis?: AnalysisResult,
  ksmScore?: number,
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const score = ksmScore ?? analysis?.rubricScore?.percentage ?? analysis?.strategy?.overallScore;
  const resultClass = result.success ? 'success' : 'failed';
  const resultText = result.success ? 'SUCCESS' : 'FAILED';
  const flagText = result.flag ? esc(result.flag) : 'Not found';
  const mins = Math.floor(result.totalTime / 60);
  const secs = Math.round(result.totalTime % 60);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  // Score bar HTML
  let scoreHtml = '';
  if (score != null && score > 0) {
    const pct = Math.min(score, 100);
    scoreHtml = `
      <div class="score-card">
        <div class="score-label">KSM Score</div>
        <div class="score-value">${score.toFixed(1)}</div>
        <div class="score-bar"><div class="score-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  // Techniques HTML
  let techniquesHtml = '';
  if (result.techniquesUsed?.length > 0) {
    const techRows = result.techniquesUsed.map(t =>
      `<tr><td class="tech-id">${esc(t.id)}</td><td>${esc(t.name)}</td><td class="dim">${esc(t.tactic)}</td></tr>`
    ).join('\n');
    techniquesHtml = `
      <h2>ATT&CK Techniques</h2>
      <table><thead><tr><th>ID</th><th>Name</th><th>Tactic</th></tr></thead>
      <tbody>${techRows}</tbody></table>`;
  }

  // Attack path HTML
  let attackPathHtml = '';
  const toolSteps = result.steps.filter(s => s.type === 'tool_call' && s.command);
  if (toolSteps.length > 0) {
    let cumTime = 0;
    const pathRows = toolSteps.map(s => {
      const t = formatDuration(cumTime);
      cumTime += s.duration;
      const techId = s.technique ? esc(s.technique.id) : '-';
      const cmd = esc(truncateStr(s.command!, 60));
      const mark = s.success ? '<span class="success">\u2713</span>' : '<span class="failed">\u2717</span>';
      return `<tr><td>${esc(String(s.iteration))}</td><td class="tech-id">${techId}</td><td class="mono">${cmd}</td><td class="dim">${esc(t)}</td><td>${mark}</td></tr>`;
    }).join('\n');
    attackPathHtml = `
      <h2>Attack Path</h2>
      <table><thead><tr><th>#</th><th>Technique</th><th>Command</th><th>Time</th><th></th></tr></thead>
      <tbody>${pathRows}</tbody></table>`;
  }

  // Tools HTML
  const toolCounts: Record<string, number> = {};
  for (const step of result.steps) {
    if (step.tool) toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
  }
  const toolsHtml = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => `<span class="tag">${esc(tool)} \u00D7${count}</span>`)
    .join(' ');

  // Analysis HTML
  let analysisHtml = '';
  if (analysis) {
    const approachClass = analysis.behavior.approach;
    const stratScores = [
      { name: 'Recon Quality', score: analysis.strategy.reconQuality },
      { name: 'Exploit Efficiency', score: analysis.strategy.exploitEfficiency },
      { name: 'Adaptability', score: analysis.strategy.adaptability },
      { name: 'Decision Quality', score: analysis.behavior.decisionQuality },
    ];
    const scoreBars = stratScores.map(s => `
      <div class="strat-row">
        <span class="strat-label">${esc(s.name)}</span>
        <div class="strat-bar"><div class="strat-fill" style="width:${Math.min(s.score, 100)}%"></div></div>
        <span class="strat-val">${s.score}</span>
      </div>`).join('');

    const strengths = analysis.behavior.strengths.length > 0
      ? analysis.behavior.strengths.map(s => `<li class="strength">${esc(s)}</li>`).join('')
      : '';
    const inefficiencies = analysis.behavior.inefficiencies.length > 0
      ? analysis.behavior.inefficiencies.map(s => `<li class="inefficiency">${esc(s)}</li>`).join('')
      : '';

    const findings = analysis.narrative.keyFindings.map(f => `<li>${esc(f)}</li>`).join('');

    analysisHtml = `
      <h2>Analysis</h2>
      <div class="summary-text">${esc(analysis.narrative.summary)}</div>

      <h3>Key Findings</h3>
      <ul>${findings}</ul>

      <h3>Strategy Scores</h3>
      ${scoreBars}

      <h3>Behavioral Approach</h3>
      <span class="approach-badge ${esc(approachClass)}">${esc(analysis.behavior.approach.toUpperCase())}</span>
      <p class="dim">${esc(analysis.behavior.approachDescription)}</p>

      ${strengths ? `<h3>Strengths</h3><ul>${strengths}</ul>` : ''}
      ${inefficiencies ? `<h3>Areas for Improvement</h3><ul>${inefficiencies}</ul>` : ''}
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OASIS Report \u2014 ${esc(result.id)}</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;--purple:#a855f7;--cyan:#22d3ee;--green:#3fb950;--red:#f85149;--yellow:#d29922;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:2rem;max-width:900px;margin:0 auto;line-height:1.6}
  h1{background:linear-gradient(90deg,var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-size:1.8rem;margin-bottom:.5rem}
  h2{color:var(--purple);font-size:1.1rem;margin:2rem 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)}
  h3{color:var(--dim);font-size:.9rem;text-transform:uppercase;letter-spacing:.05em;margin:1.5rem 0 .5rem}
  .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.75rem;margin:1rem 0}
  .meta-item{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.75rem 1rem}
  .meta-label{color:var(--dim);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  .meta-value{font-size:1.1rem;font-weight:600;margin-top:.2rem}
  .success{color:var(--green)} .failed{color:var(--red)}
  .score-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.5rem;text-align:center;margin:1.5rem 0}
  .score-label{color:var(--dim);font-size:.8rem;text-transform:uppercase;letter-spacing:.1em}
  .score-value{font-size:3rem;font-weight:700;background:linear-gradient(90deg,var(--purple),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .score-bar{background:var(--border);border-radius:4px;height:8px;margin-top:.75rem;overflow:hidden}
  .score-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--cyan));border-radius:4px;transition:width .3s}
  table{width:100%;border-collapse:collapse;margin:.5rem 0}
  th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid var(--border);font-size:.85rem}
  th{color:var(--dim);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  .tech-id{color:var(--yellow);font-weight:600}
  .mono{font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-size:.8rem}
  .dim{color:var(--dim)}
  .tag{display:inline-block;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:.2rem .5rem;font-size:.8rem;margin:.2rem}
  .strat-row{display:flex;align-items:center;gap:.75rem;margin:.4rem 0}
  .strat-label{width:140px;color:var(--dim);font-size:.85rem}
  .strat-bar{flex:1;background:var(--border);border-radius:4px;height:6px;overflow:hidden}
  .strat-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--cyan));border-radius:4px}
  .strat-val{width:30px;text-align:right;font-size:.85rem;color:var(--cyan)}
  .approach-badge{display:inline-block;padding:.3rem .75rem;border-radius:4px;font-size:.8rem;font-weight:700;letter-spacing:.05em}
  .approach-badge.methodical{background:#3fb95020;color:var(--green)}
  .approach-badge.aggressive{background:#f8514920;color:var(--red)}
  .approach-badge.exploratory{background:#d2992220;color:var(--yellow)}
  .approach-badge.targeted{background:#22d3ee20;color:var(--cyan)}
  .summary-text{background:var(--card);border-left:3px solid var(--purple);padding:1rem;border-radius:0 8px 8px 0;margin:.75rem 0}
  ul{padding-left:1.25rem}
  li{margin:.3rem 0;font-size:.9rem}
  li.strength::marker{color:var(--green)} li.inefficiency::marker{color:var(--yellow)}
  .footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--border);color:var(--dim);font-size:.8rem;text-align:center}
  .footer a{color:var(--purple);text-decoration:none}
  @media(max-width:600px){body{padding:1rem}.meta-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
  <h1>OASIS</h1>
  <p class="dim">AI Security Benchmark Report</p>

  ${scoreHtml}

  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Run ID</div><div class="meta-value">${esc(result.id)}</div></div>
    <div class="meta-item"><div class="meta-label">Challenge</div><div class="meta-value">${esc(result.challenge)}</div></div>
    <div class="meta-item"><div class="meta-label">Model</div><div class="meta-value">${esc(result.modelVersion)}</div></div>
    <div class="meta-item"><div class="meta-label">Result</div><div class="meta-value ${resultClass}">${resultText}</div></div>
    <div class="meta-item"><div class="meta-label">Flag</div><div class="meta-value">${result.success ? `<span class="success">${flagText}</span>` : `<span class="dim">${flagText}</span>`}</div></div>
    <div class="meta-item"><div class="meta-label">Time</div><div class="meta-value">${timeStr}</div></div>
    <div class="meta-item"><div class="meta-label">Steps</div><div class="meta-value">${esc(String(result.iterations))}</div></div>
    <div class="meta-item"><div class="meta-label">Tokens</div><div class="meta-value">${esc(result.tokens.total.toLocaleString())}</div></div>
  </div>

  <h2>Tools Used</h2>
  <div>${toolsHtml}</div>

  ${techniquesHtml}
  ${attackPathHtml}
  ${analysisHtml}

  <div class="footer">
    Generated by <a href="https://oasis.kryptsec.com">OASIS</a> \u2014 AI Security Benchmarking
  </div>
</body>
</html>`;
}
