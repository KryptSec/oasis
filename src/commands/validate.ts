import { Command } from 'commander';
import { resolve, basename } from 'path';
import { existsSync, readFileSync } from 'fs';
import { colors, status, printHeader } from '../lib/display.js';

export const validateCommand = new Command('validate')
  .description('Validate a challenge configuration')
  .argument('<path>', 'Path to challenge directory')
  .option('--json', 'Output results as JSON', false)
  .action(async (challengePath, options) => {
    const absPath = resolve(process.cwd(), challengePath);
    const challengeName = basename(absPath);

    const result = validateChallenge(absPath, challengeName);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    }

    // Display results
    printHeader(`Validating: ${challengeName}`);

    const statusIcon = result.valid ? status.success : status.error;
    const statusColor = result.valid ? colors.green : colors.red;
    console.log(`\n  ${statusIcon} ${statusColor(result.valid ? 'VALID' : 'INVALID')}`);

    if (result.errors.length > 0) {
      console.log(colors.red('\n  Errors:'));
      for (const error of result.errors) {
        console.log(`    ${status.error} ${error}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log(colors.yellow('\n  Warnings:'));
      for (const warning of result.warnings) {
        console.log(`    ${status.warning} ${warning}`);
      }
    }

    if (result.valid && result.errors.length === 0 && result.warnings.length === 0) {
      console.log(colors.green('\n  All checks passed!'));
    }

    console.log();

    process.exit(result.valid ? 0 : 1);
  });

export interface ValidationResult {
  challenge: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const SAFE_CONTAINER_NAME_PATTERN = /^(?!-)[A-Za-z0-9_-]{1,63}$/;
const RESERVED_CONTAINER_NAMES = new Set(['host', 'none', 'bridge']);

function validateContainerName(containerName: string): string | null {
  if (!SAFE_CONTAINER_NAME_PATTERN.test(containerName)) {
    return `Invalid containerName "${containerName}". Must be 1-63 characters, use only letters/numbers/hyphens/underscores, and cannot start with a hyphen.`;
  }

  if (RESERVED_CONTAINER_NAMES.has(containerName.toLowerCase())) {
    return `Invalid containerName "${containerName}". Reserved Docker network names are not allowed: host, none, bridge.`;
  }

  return null;
}

export function validateChallenge(challengePath: string, challengeName: string): ValidationResult {
  const result: ValidationResult = {
    challenge: challengeName,
    valid: true,
    errors: [],
    warnings: [],
  };

  // Check directory exists
  if (!existsSync(challengePath)) {
    result.errors.push(`Directory not found: ${challengePath}`);
    result.valid = false;
    return result;
  }

  // Check required files
  const requiredFiles = ['challenge.json', 'docker-compose.yml'];
  for (const file of requiredFiles) {
    const filePath = resolve(challengePath, file);
    if (!existsSync(filePath)) {
      result.errors.push(`Missing required file: ${file}`);
      result.valid = false;
    }
  }

  // Check optional files
  const optionalFiles = ['README.md'];
  for (const file of optionalFiles) {
    const filePath = resolve(challengePath, file);
    if (!existsSync(filePath)) {
      result.warnings.push(`Missing optional file: ${file}`);
    }
  }

  // Load and validate challenge.json
  const configPath = resolve(challengePath, 'challenge.json');
  if (!existsSync(configPath)) {
    return result;
  }

  let config: any;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    result.errors.push(`Invalid JSON in challenge.json: ${e}`);
    result.valid = false;
    return result;
  }

  // Required fields
  const requiredFields = [
    'id', 'name', 'category', 'difficulty', 'target',
    'flagFormat', 'description', 'containerName', 'limits',
    'scoring', 'expectedApproach', 'metadata'
  ];

  for (const field of requiredFields) {
    if (!config[field]) {
      result.errors.push(`Missing required field: ${field}`);
      result.valid = false;
    }
  }

  // Validate ID matches directory name
  if (config.id && config.id !== challengeName) {
    result.errors.push(`Challenge ID "${config.id}" does not match directory name "${challengeName}"`);
    result.valid = false;
  }

  // Validate category
  const validCategories = ['web', 'network', 'crypto', 'forensics', 'misc'];
  if (config.category && !validCategories.includes(config.category)) {
    result.errors.push(`Invalid category "${config.category}". Must be one of: ${validCategories.join(', ')}`);
    result.valid = false;
  }

  // Validate difficulty
  const validDifficulties = ['easy', 'medium', 'hard', 'expert'];
  if (config.difficulty && !validDifficulties.includes(config.difficulty)) {
    result.errors.push(`Invalid difficulty "${config.difficulty}". Must be one of: ${validDifficulties.join(', ')}`);
    result.valid = false;
  }

  // Validate container name safety constraints
  if (config.containerName) {
    const containerNameError = validateContainerName(config.containerName);
    if (containerNameError) {
      result.errors.push(containerNameError);
      result.valid = false;
    }
  }

  // Validate flag format is a valid regex
  if (config.flagFormat) {
    try {
      new RegExp(config.flagFormat);
    } catch (e) {
      result.errors.push(`Invalid flagFormat regex: ${config.flagFormat}`);
      result.valid = false;
    }
  }

  // Validate limits
  if (config.limits) {
    // Required limit fields
    if (!config.limits.maxIterations) {
      result.errors.push('Missing required field: limits.maxIterations');
      result.valid = false;
    } else if (config.limits.maxIterations < 1) {
      result.errors.push('limits.maxIterations must be at least 1');
      result.valid = false;
    }

    if (!config.limits.maxTimeSeconds) {
      result.errors.push('Missing required field: limits.maxTimeSeconds');
      result.valid = false;
    } else if (config.limits.maxTimeSeconds < 60) {
      result.errors.push('limits.maxTimeSeconds must be at least 60 seconds');
      result.valid = false;
    }

    // Optional expectedIterations
    if (config.limits.expectedIterations) {
      if (config.limits.expectedIterations < 1) {
        result.errors.push('limits.expectedIterations must be at least 1');
        result.valid = false;
      }

      // Warn if maxIterations is less than 3x expectedIterations
      if (config.limits.maxIterations && config.limits.maxIterations < config.limits.expectedIterations * 3) {
        result.warnings.push(
          `limits.maxIterations (${config.limits.maxIterations}) is less than 3x expectedIterations (${config.limits.expectedIterations * 3}). Consider the 3x rule.`
        );
      }
    }

    // Warn if time limit seems too short for iteration count
    if (config.limits.maxIterations && config.limits.maxTimeSeconds) {
      const secondsPerIteration = config.limits.maxTimeSeconds / config.limits.maxIterations;
      if (secondsPerIteration < 5) {
        result.warnings.push(
          `Time limit may be too short: ${secondsPerIteration.toFixed(1)}s per iteration average. Agents typically need 5-15s per iteration.`
        );
      }
    }
  }

  // Validate scoring structure
  if (config.scoring) {
    if (!config.scoring.version) {
      result.errors.push('Missing scoring.version');
      result.valid = false;
    }

    if (!config.scoring.milestones || config.scoring.milestones.length < 3) {
      result.errors.push('Scoring must have at least 3 milestones');
      result.valid = false;
    }

    // Check for required milestone IDs
    if (config.scoring.milestones) {
      const milestoneIds = config.scoring.milestones.map((m: any) => m.id);
      const requiredMilestones = ['recon', 'vuln_id', 'flag'];
      for (const required of requiredMilestones) {
        if (!milestoneIds.includes(required)) {
          result.warnings.push(`Missing recommended milestone: ${required}`);
        }
      }

      // Check for duplicate orders
      const orders = config.scoring.milestones.map((m: any) => m.order);
      const uniqueOrders = new Set(orders);
      if (orders.length !== uniqueOrders.size) {
        result.errors.push('Duplicate milestone order values found');
        result.valid = false;
      }
    }
  }

  // Validate OWASP categories format
  if (config.expectedApproach?.owaspCategory) {
    const owaspPattern = /^A[0-9]{2}:[0-9]{4}-.+$/;
    for (const category of config.expectedApproach.owaspCategory) {
      if (!owaspPattern.test(category)) {
        result.warnings.push(`Invalid OWASP category format: ${category} (expected A##:####-Name)`);
      }
    }
  }

  // Validate MITRE ATT&CK technique IDs
  if (config.expectedApproach?.expectedTechniques) {
    const mitrePattern = /^T[0-9]{4}(\.[0-9]{3})?$/;
    for (const technique of config.expectedApproach.expectedTechniques) {
      if (!mitrePattern.test(technique)) {
        result.warnings.push(`Invalid MITRE technique ID format: ${technique} (expected T####[.###])`);
      }
    }
  }

  // Validate estimated times
  if (config.metadata?.estimatedTime) {
    const [min, max] = config.metadata.estimatedTime;
    if (min >= max) {
      result.errors.push(`Invalid estimatedTime: min (${min}) should be less than max (${max})`);
      result.valid = false;
    }
  }

  return result;
}
