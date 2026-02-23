import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { colors, status } from '../lib/display.js';
import { resolveAnalysisPath, resolveResultPath, InvalidRunIdError, ResultPathEscapeError } from '../lib/results-path.js';
import {
  printColorReport,
  generateTextReport,
  generateJsonReport,
  generateMarkdownReport,
  printAnalysisSummary,
  generateAnalysisTextReport,
} from '../lib/report.js';
import type { RunResult, AnalysisResult } from '../lib/types.js';


export const reportCommand = new Command('report')
  .description('Generate a report for a benchmark run')
  .argument('<run-id>', 'Run ID to generate report for')
  .option('-f, --format <format>', 'Output format: terminal, text, json, md', 'terminal')
  .option('-o, --output <path>', 'Write report to file (instead of stdout)')
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

    const result: RunResult = JSON.parse(readFileSync(resultPath, 'utf-8'));

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

      default:
        console.error(colors.red(`\n${status.error} Unknown format: ${format}`));
        console.log(colors.gray(`  Supported formats: terminal, text, json, md`));
        process.exit(1);
    }

    if (options.output) {
      writeFileSync(options.output, output);
      console.log(colors.green(`\n${status.success} Report written to: ${options.output}`));
    } else {
      console.log(output);
    }
  });
