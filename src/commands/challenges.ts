import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { colors, printHeader, formatDifficulty, formatCategory } from '../lib/display.js';
import { getChallengesDir } from '../lib/config.js';
import { fetchRegistryIndex } from '../lib/registry.js';
import type { RegistryEntry } from '../lib/registry.js';

interface ChallengeConfig {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  description: string;
  target: string;
  metadata?: {
    estimatedTime?: [number, number];
    skillLevel?: string;
  };
  expectedApproach?: {
    vulnerabilityType?: string[];
    owaspCategory?: string[];
  };
}

export const challengesCommand = new Command('challenges')
  .description('List available challenges')
  .option('--local', 'List challenges from local directory instead of registry')
  .option('--category <category>', 'Filter by category (web, network, crypto, etc.)')
  .option('--difficulty <level>', 'Filter by difficulty (easy, medium, hard, expert)')
  .option('--json', 'Output as JSON', false)
  .action(async (options) => {
    if (options.local) {
      displayLocalChallenges(options);
    } else {
      await displayRegistryChallenges(options);
    }
  });

async function displayRegistryChallenges(options: { category?: string; difficulty?: string; json?: boolean }): Promise<void> {
  try {
    const index = await fetchRegistryIndex();
    let challenges = index.challenges;

    if (challenges.length === 0) {
      console.log(colors.yellow('\nNo challenges found in registry.'));
      console.log(colors.gray(`  Use --local to list local challenges instead.`));
      return;
    }

    // Apply filters
    if (options.category) {
      challenges = challenges.filter(
        (c) => c.category.toLowerCase() === options.category!.toLowerCase()
      );
    }

    if (options.difficulty) {
      challenges = challenges.filter(
        (c) => c.difficulty.toLowerCase() === options.difficulty!.toLowerCase()
      );
    }

    // Sort by difficulty, then name
    const difficultyOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };
    challenges.sort((a, b) => {
      const diffA = difficultyOrder[a.difficulty.toLowerCase()] ?? 99;
      const diffB = difficultyOrder[b.difficulty.toLowerCase()] ?? 99;
      if (diffA !== diffB) return diffA - diffB;
      return a.name.localeCompare(b.name);
    });

    if (options.json) {
      console.log(JSON.stringify(challenges, null, 2));
      return;
    }

    // Display challenges
    printHeader(`Online Challenges (${challenges.length})`);

    for (const challenge of challenges) {
      console.log();
      console.log(
        `  ${colors.white.bold(challenge.name)} ` +
        formatCategory(challenge.category) + ' ' +
        formatDifficulty(challenge.difficulty)
      );
      console.log(colors.gray(`  ID: ${challenge.id}`));
      console.log(colors.gray(`  ${challenge.description.slice(0, 80)}${challenge.description.length > 80 ? '...' : ''}`));
    }

    console.log();
    console.log(colors.gray(`Run a challenge: oasis run -c <id> -m <model>`));
    console.log(colors.gray(`List local challenges: oasis challenges --local`));
    console.log();
  } catch (err) {
    console.error(colors.red(`\nFailed to fetch challenge registry.`));
    console.error(colors.red(`  ${err instanceof Error ? err.message : 'Unknown error'}`));
    console.log(colors.gray(`\n  Use --local to list local challenges instead.`));
    console.log();
  }
}

function displayLocalChallenges(options: { category?: string; difficulty?: string; json?: boolean }): void {
  const challenges = loadChallenges();

  if (challenges.length === 0) {
    console.log(colors.yellow('\nNo challenges found.'));
    console.log(colors.gray(`  Challenge directory: ${getChallengesDir()}`));
    return;
  }

  // Apply filters
  let filtered = challenges;

  if (options.category) {
    filtered = filtered.filter(
      (c) => c.category.toLowerCase() === options.category!.toLowerCase()
    );
  }

  if (options.difficulty) {
    filtered = filtered.filter(
      (c) => c.difficulty.toLowerCase() === options.difficulty!.toLowerCase()
    );
  }

  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  // Display challenges
  printHeader(`Local Challenges (${filtered.length})`);

  for (const challenge of filtered) {
    console.log();
    console.log(
      `  ${colors.white.bold(challenge.name)} ` +
      formatCategory(challenge.category) + ' ' +
      formatDifficulty(challenge.difficulty)
    );
    console.log(colors.gray(`  ID: ${challenge.id}`));
    console.log(colors.gray(`  ${challenge.description.slice(0, 80)}${challenge.description.length > 80 ? '...' : ''}`));

    // Show vulnerability types if available
    if (challenge.expectedApproach?.vulnerabilityType?.length) {
      const vulns = challenge.expectedApproach.vulnerabilityType.join(', ');
      console.log(colors.cyan(`  Vulnerabilities: ${vulns}`));
    }

    // Show OWASP category if available
    if (challenge.expectedApproach?.owaspCategory?.length) {
      const owasp = challenge.expectedApproach.owaspCategory[0];
      console.log(colors.purple(`  OWASP: ${owasp}`));
    }

    // Show estimated time
    if (challenge.metadata?.estimatedTime) {
      const [min, max] = challenge.metadata.estimatedTime;
      const minStr = formatSeconds(min);
      const maxStr = formatSeconds(max);
      console.log(colors.gray(`  Estimated time: ${minStr} - ${maxStr}`));
    }
  }

  console.log();
  console.log(colors.gray(`Run a challenge: oasis run -c <id> --local <path> -m <model>`));
  console.log();
}

function loadChallenges(): ChallengeConfig[] {
  if (!existsSync(getChallengesDir())) {
    return [];
  }

  const challenges: ChallengeConfig[] = [];

  const dirs = readdirSync(getChallengesDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const configPath = resolve(getChallengesDir(), dir.name, 'challenge.json');
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        challenges.push(config);
      } catch (e) {
        // Skip invalid configs
      }
    }
  }

  // Sort by difficulty, then name
  const difficultyOrder = { easy: 0, medium: 1, hard: 2, expert: 3 };
  challenges.sort((a, b) => {
    const diffA = difficultyOrder[a.difficulty.toLowerCase() as keyof typeof difficultyOrder] ?? 99;
    const diffB = difficultyOrder[b.difficulty.toLowerCase() as keyof typeof difficultyOrder] ?? 99;
    if (diffA !== diffB) return diffA - diffB;
    return a.name.localeCompare(b.name);
  });

  return challenges;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
