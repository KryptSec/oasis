import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { getChallengesDir, getResultsDir } from '../lib/config.js';
import { calculateKSS } from '../lib/scoring.js';
import type { ChallengeConfig, RunResult, AnalysisResult } from '../lib/types.js';

// =============================================================================
// Challenge Loader
// =============================================================================

export function loadLocalChallenges(): ChallengeConfig[] {
  const dir = getChallengesDir();
  if (!existsSync(dir)) return [];

  const challenges: ChallengeConfig[] = [];

  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const entry of dirs) {
    const configPath = resolve(dir, entry.name, 'challenge.json');
    if (existsSync(configPath)) {
      try {
        challenges.push(JSON.parse(readFileSync(configPath, 'utf-8')));
      } catch {
        // Skip invalid configs
      }
    }
  }

  const difficultyOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };
  challenges.sort((a, b) => {
    const diffA = difficultyOrder[a.difficulty.toLowerCase()] ?? 99;
    const diffB = difficultyOrder[b.difficulty.toLowerCase()] ?? 99;
    if (diffA !== diffB) return diffA - diffB;
    return a.name.localeCompare(b.name);
  });

  return challenges;
}

// =============================================================================
// Results Loader
// =============================================================================

export interface LoadedResult {
  id: string;
  result: RunResult;
  analysis: AnalysisResult | null;
  score: number;
}

export function loadRecentResults(limit = 20): LoadedResult[] {
  const dir = getResultsDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.includes('.analysis.'))
    .map(f => {
      const fullPath = resolve(dir, f);
      return {
        id: f.replace('.json', ''),
        path: fullPath,
        time: statSync(fullPath).mtime.getTime(),
      };
    })
    .sort((a, b) => b.time - a.time);

  const results: LoadedResult[] = [];

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const result: RunResult = JSON.parse(readFileSync(file.path, 'utf-8'));
      const analysisPath = resolve(dir, `${file.id}.analysis.json`);
      let analysis: AnalysisResult | null = null;
      let score = 0;

      if (existsSync(analysisPath)) {
        try {
          analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
          const methodology = analysis!.rubricScore?.total ?? analysis!.strategy?.overallScore ?? 0;
          score = calculateKSS(methodology, result.success ? 100 : 0);
        } catch { /* skip */ }
      }

      results.push({ id: file.id, result, analysis, score });
    } catch { /* skip malformed */ }
  }

  return results;
}
