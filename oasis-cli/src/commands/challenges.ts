import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { colors, printHeader, formatDifficulty, formatCategory } from '../lib/display.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHALLENGES_DIR = resolve(__dirname, '../../../challenges');

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
  .option('--category <category>', 'Filter by category (web, network, crypto, etc.)')
  .option('--difficulty <level>', 'Filter by difficulty (easy, medium, hard, expert)')
  .option('--json', 'Output as JSON', false)
  .action(async (options) => {
    const challenges = loadChallenges();

    if (challenges.length === 0) {
      console.log(colors.yellow('\nNo challenges found.'));
      console.log(colors.gray(`  Challenge directory: ${CHALLENGES_DIR}`));
      return;
    }

    // Apply filters
    let filtered = challenges;

    if (options.category) {
      filtered = filtered.filter(
        (c) => c.category.toLowerCase() === options.category.toLowerCase()
      );
    }

    if (options.difficulty) {
      filtered = filtered.filter(
        (c) => c.difficulty.toLowerCase() === options.difficulty.toLowerCase()
      );
    }

    if (options.json) {
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }

    // Display challenges
    printHeader(`Available Challenges (${filtered.length})`);

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
    console.log(colors.gray(`Run a challenge: oasis run --challenge <id> --model <model>`));
    console.log();
  });

function loadChallenges(): ChallengeConfig[] {
  if (!existsSync(CHALLENGES_DIR)) {
    return [];
  }

  const challenges: ChallengeConfig[] = [];

  const dirs = readdirSync(CHALLENGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const configPath = resolve(CHALLENGES_DIR, dir.name, 'challenge.json');
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
