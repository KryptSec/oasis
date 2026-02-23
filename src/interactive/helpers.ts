import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { getChallengesDir, getResultsDir } from '../lib/config.js';
import { calculateKSM, calculateEfficacyFromResults } from '../lib/scoring.js';
import { fetchRegistryIndex, fetchChallengeConfig } from '../lib/registry.js';
import type { RegistryEntry } from '../lib/registry.js';
import type { ChallengeConfig, RunResult, AnalysisResult } from '../lib/types.js';

// =============================================================================
// Challenge Loader (Local)
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
// Challenge Loader (Registry)
// =============================================================================

export interface RegistryChallengeChoice {
  entry: RegistryEntry;
  config: ChallengeConfig;
}

/**
 * Fetch challenges from the online registry.
 * Returns registry entries paired with their full challenge configs.
 */
export async function loadRegistryChallenges(): Promise<RegistryChallengeChoice[]> {
  const index = await fetchRegistryIndex();
  const choices: RegistryChallengeChoice[] = [];

  for (const entry of index.challenges) {
    try {
      const config = await fetchChallengeConfig(entry);
      choices.push({ entry, config });
    } catch {
      // Skip challenges whose config can't be fetched
    }
  }

  const difficultyOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };
  choices.sort((a, b) => {
    const diffA = difficultyOrder[a.config.difficulty.toLowerCase()] ?? 99;
    const diffB = difficultyOrder[b.config.difficulty.toLowerCase()] ?? 99;
    if (diffA !== diffB) return diffA - diffB;
    return a.config.name.localeCompare(b.config.name);
  });

  return choices;
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

  // First pass: load all results and analyses (need all for efficacy calculation)
  const allEntries: { id: string; result: RunResult; analysis: AnalysisResult | null }[] = [];
  for (const file of files) {
    try {
      const result: RunResult = JSON.parse(readFileSync(file.path, 'utf-8'));
      const analysisPath = resolve(dir, `${file.id}.analysis.json`);
      let analysis: AnalysisResult | null = null;

      if (existsSync(analysisPath)) {
        try {
          analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
        } catch { /* skip */ }
      }

      allEntries.push({ id: file.id, result, analysis });
    } catch { /* skip malformed */ }
  }

  // Second pass: compute scores with proper multi-run efficacy, then limit
  const allResults = allEntries.map(e => e.result);
  const results: LoadedResult[] = [];

  for (const { id, result, analysis } of allEntries) {
    if (results.length >= limit) break;
    let score = 0;

    if (analysis) {
      const methodology = analysis.rubricScore?.percentage ?? analysis.strategy?.overallScore ?? 0;
      const efficacy = calculateEfficacyFromResults(result.challenge, result.modelVersion, allResults);
      score = calculateKSM(methodology, efficacy);
    }

    results.push({ id, result, analysis, score });
  }

  return results;
}
