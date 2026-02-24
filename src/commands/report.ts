import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve as pathResolve } from 'path';
import { execSync } from 'child_process';
import { colors, status } from '../lib/display.js';
import { getResultsDir } from '../lib/config.js';
import { calculateKSM, calculateEfficacyFromResults } from '../lib/scoring.js';
import { resolveAnalysisPath, resolveResultPath, InvalidRunIdError, ResultPathEscapeError } from '../lib/results-path.js';
import {
  printColorReport,
  generateTextReport,
  generateJsonReport,
  generateMarkdownReport,
  generateShareCard,
  generateHtmlReport,
  printAnalysisSummary,
  generateAnalysisTextReport,
} from '../lib/report.js';
import type { RunResult, AnalysisResult } from '../lib/types.js';

function computeKsmScore(result: RunResult, analysis?: AnalysisResult): number | undefined {
  if (!analysis) return undefined;
  try {
    const methodology = analysis.rubricScore?.percentage ?? analysis.strategy?.overallScore ?? 0;
    // Load all results for multi-run efficacy
    const resultsDir = getResultsDir();
    const allResults: RunResult[] = [];
    if (existsSync(resultsDir)) {
      for (const f of readdirSync(resultsDir).filter(f => f.endsWith('.json') && !f.includes('.analysis.'))) {
        try {
          allResults.push(JSON.parse(readFileSync(pathResolve(resultsDir, f), 'utf-8')));
        } catch {}
      }
    }
    const efficacy = calculateEfficacyFromResults(result.challenge, result.modelVersion, allResults);
    return calculateKSM(methodology, efficacy);
  } catch {
    return undefined;
  }
}

function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else if (process.platform === 'win32') {
      execSync('clip', { input: text });
    } else {
      // Linux — try xclip, fall back to xsel
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

export const reportCommand = new Command('report')
  .description('Generate a report for a benchmark run')
  .argument('<run-id>', 'Run ID to generate report for')
  .option('-f, --format <format>', 'Output format: terminal, text, json, md, share, html', 'terminal')
  .option('-o, --output <path>', 'Write report to file (instead of stdout)')
  .option('--clipboard', 'Copy output to clipboard')
  .action((runId, options) => {
    let resultPath: string;
    let analysisPath: string;
    try {
      resultPath = resolveResultPath(runId);
      analysisPath = resolveAnalysisPath(runId);
    } catch (error) {
      if (error instanceof InvalidRunIdError || error instanceof ResultPathEscapeError) {
        console.error(colors.red(`\n${status.error} Invalid run ID: ${runId}`));
        console.log(colors.gray('  Use only letters, numbers, "_" or "-".'));
        process.exit(1);
      }
      throw error;
    }

    if (!existsSync(resultPath)) {
      console.error(colors.red(`\n${status.error} Run not found: ${runId}`));
      process.exit(1);
    }

    let result: RunResult;
    try {
      result = JSON.parse(readFileSync(resultPath, 'utf-8'));
    } catch {
      console.error(colors.red(`\n${status.error} Failed to parse result file: ${resultPath}`));
      console.log(colors.gray('  The file may be corrupted. Try re-running the benchmark.'));
      process.exit(1);
    }

    // Load analysis if available
    let analysis: AnalysisResult | undefined;
    if (existsSync(analysisPath)) {
      try {
        analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
      } catch {}
    }

    const format = options.format.toLowerCase();
    let output = '';

    switch (format) {
      case 'terminal':
        if (options.clipboard || options.output) {
          console.warn(colors.yellow(`\n${status.warning} --clipboard and --output are not supported with terminal format (ANSI colors cannot be preserved).`));
          console.log(colors.gray('  Use --format text, md, json, share, or html instead.\n'));
        }
        printColorReport(result);
        if (analysis) {
          printAnalysisSummary(analysis);
        }
        return;

      case 'text':
      case 'txt':
        output = generateTextReport(result);
        if (analysis) {
          output += '\n' + generateAnalysisTextReport(analysis);
        }
        break;

      case 'json':
        output = generateJsonReport(result, analysis);
        break;

      case 'md':
      case 'markdown':
        output = generateMarkdownReport(result, analysis);
        break;

      case 'share':
        output = generateShareCard(result, analysis, computeKsmScore(result, analysis));
        break;

      case 'html':
        output = generateHtmlReport(result, analysis, computeKsmScore(result, analysis));
        break;

      default:
        console.error(colors.red(`\n${status.error} Unknown format: ${format}`));
        console.log(colors.gray(`  Supported formats: terminal, text, json, md, share, html`));
        process.exit(1);
    }

    if (options.clipboard) {
      if (copyToClipboard(output)) {
        console.log(colors.green(`\n${status.success} Copied to clipboard!`));
      } else {
        console.log(colors.yellow(`\n${status.warning} Could not copy to clipboard. Output printed below.\n`));
        console.log(output);
      }
    } else if (options.output) {
      writeFileSync(options.output, output);
      console.log(colors.green(`\n${status.success} Report written to: ${options.output}`));
    } else {
      console.log(output);
    }
  });
