#!/usr/bin/env npx ts-node

/**
 * OASIS Challenge Validator
 *
 * Validates challenge configurations against the OASIS Challenge Specification.
 *
 * Usage:
 *   npx ts-node scripts/validate-challenge.ts ./challenges/gatekeeper
 *   npx ts-node scripts/validate-challenge.ts --all
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join, basename } from 'path';
import Ajv from 'ajv';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

interface ValidationResult {
  challenge: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ChallengeConfig {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  target: string;
  flagFormat: string;
  description: string;
  containerName: string;
  scoring: {
    version: string;
    objective: {
      flagCapture: number;
      timeBonus: { maxPoints: number; targetSeconds: number; decayRate: number };
      efficiencyBonus: { maxPoints: number; optimalSteps: number; penaltyPerStep: number };
    };
    milestones: Array<{
      id: string;
      name: string;
      points: number;
      criteria: string;
      order: number;
    }>;
    qualitative: {
      reconQuality: { maxPoints: number; criteria: string };
      techniqueSelection: { maxPoints: number; criteria: string };
      adaptability: { maxPoints: number; criteria: string };
    };
    penalties: {
      excessiveFailures: { threshold: number; penalty: number };
      offTargetActivity: { penalty: number };
      bruteForce: { penalty: number };
    };
  };
  expectedApproach: {
    vulnerabilityType: string[];
    owaspCategory: string[];
    expectedTechniques: string[];
    optimalPath: string;
    alternativePaths: string[];
    antiPatterns: string[];
  };
  metadata: {
    estimatedTime: [number, number];
    estimatedSteps: [number, number];
    skillLevel: string;
    realWorldRelevance: string;
  };
}

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function loadSchema(): object {
  const schemaPath = resolve(__dirname, '../spec/challenge-schema.json');
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema not found at ${schemaPath}`);
  }
  return JSON.parse(readFileSync(schemaPath, 'utf-8'));
}

function validateChallenge(challengePath: string): ValidationResult {
  const challengeName = basename(challengePath);
  const result: ValidationResult = {
    challenge: challengeName,
    valid: true,
    errors: [],
    warnings: [],
  };

  // Check required files
  const requiredFiles = ['challenge.json', 'docker-compose.yml'];
  for (const file of requiredFiles) {
    const filePath = join(challengePath, file);
    if (!existsSync(filePath)) {
      result.errors.push(`Missing required file: ${file}`);
      result.valid = false;
    }
  }

  // Check optional files
  const optionalFiles = ['README.md'];
  for (const file of optionalFiles) {
    const filePath = join(challengePath, file);
    if (!existsSync(filePath)) {
      result.warnings.push(`Missing optional file: ${file}`);
    }
  }

  // Load and validate challenge.json
  const configPath = join(challengePath, 'challenge.json');
  if (!existsSync(configPath)) {
    return result;
  }

  let config: ChallengeConfig;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    result.errors.push(`Invalid JSON in challenge.json: ${e}`);
    result.valid = false;
    return result;
  }

  // Schema validation
  const schema = loadSchema();
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const schemaValid = validate(config);

  if (!schemaValid && validate.errors) {
    for (const error of validate.errors) {
      result.errors.push(`Schema error at ${error.instancePath}: ${error.message}`);
    }
    result.valid = false;
  }

  // Additional validation rules
  if (config.id !== challengeName) {
    result.errors.push(`Challenge ID "${config.id}" does not match directory name "${challengeName}"`);
    result.valid = false;
  }

  // Validate flag format is a valid regex
  try {
    new RegExp(config.flagFormat);
  } catch (e) {
    result.errors.push(`Invalid flagFormat regex: ${config.flagFormat}`);
    result.valid = false;
  }

  // Validate milestone ordering
  if (config.scoring?.milestones) {
    const orders = config.scoring.milestones.map(m => m.order);
    const uniqueOrders = new Set(orders);
    if (orders.length !== uniqueOrders.size) {
      result.errors.push('Duplicate milestone order values found');
      result.valid = false;
    }

    // Check for required milestones
    const milestoneIds = config.scoring.milestones.map(m => m.id);
    const requiredMilestones = ['recon', 'vuln_id', 'flag'];
    for (const required of requiredMilestones) {
      if (!milestoneIds.includes(required)) {
        result.warnings.push(`Missing recommended milestone: ${required}`);
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

  // Validate scoring totals
  if (config.scoring) {
    const { objective, milestones, qualitative } = config.scoring;
    const totalObjective = objective.flagCapture + objective.timeBonus.maxPoints + objective.efficiencyBonus.maxPoints;
    const totalMilestones = milestones.reduce((sum, m) => sum + m.points, 0);
    const totalQualitative = qualitative.reconQuality.maxPoints +
                            qualitative.techniqueSelection.maxPoints +
                            qualitative.adaptability.maxPoints;

    const maxPossible = totalObjective + totalMilestones + totalQualitative;

    if (maxPossible > 200) {
      result.warnings.push(`High max possible score: ${maxPossible} (typical is 100-150)`);
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

  // Validate estimated steps
  if (config.metadata?.estimatedSteps) {
    const [min, max] = config.metadata.estimatedSteps;
    if (min >= max) {
      result.errors.push(`Invalid estimatedSteps: min (${min}) should be less than max (${max})`);
      result.valid = false;
    }
  }

  return result;
}

function printResult(result: ValidationResult): void {
  const statusIcon = result.valid ? '✓' : '✗';
  const statusColor = result.valid ? colors.green : colors.red;

  log(`\n${colors.bold}${statusColor}${statusIcon} ${result.challenge}${colors.reset}`);

  if (result.errors.length > 0) {
    log('  Errors:', colors.red);
    for (const error of result.errors) {
      log(`    • ${error}`, colors.red);
    }
  }

  if (result.warnings.length > 0) {
    log('  Warnings:', colors.yellow);
    for (const warning of result.warnings) {
      log(`    • ${warning}`, colors.yellow);
    }
  }

  if (result.valid && result.errors.length === 0 && result.warnings.length === 0) {
    log('  All checks passed!', colors.green);
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    log('OASIS Challenge Validator', colors.cyan);
    log('\nUsage:', colors.bold);
    log('  npx ts-node scripts/validate-challenge.ts <challenge-path>');
    log('  npx ts-node scripts/validate-challenge.ts --all');
    log('\nExamples:', colors.bold);
    log('  npx ts-node scripts/validate-challenge.ts ./challenges/gatekeeper');
    log('  npx ts-node scripts/validate-challenge.ts --all');
    process.exit(0);
  }

  log(`\n${colors.cyan}${colors.bold}OASIS Challenge Validator${colors.reset}\n`);

  let challengePaths: string[] = [];

  if (args[0] === '--all') {
    const challengesDir = resolve(__dirname, '../challenges');
    if (!existsSync(challengesDir)) {
      log(`Challenges directory not found: ${challengesDir}`, colors.red);
      process.exit(1);
    }

    const entries = readdirSync(challengesDir, { withFileTypes: true });
    challengePaths = entries
      .filter(e => e.isDirectory())
      .map(e => join(challengesDir, e.name));
  } else {
    const challengePath = resolve(args[0]);
    if (!existsSync(challengePath)) {
      log(`Challenge path not found: ${challengePath}`, colors.red);
      process.exit(1);
    }
    challengePaths = [challengePath];
  }

  if (challengePaths.length === 0) {
    log('No challenges found to validate.', colors.yellow);
    process.exit(0);
  }

  log(`Validating ${challengePaths.length} challenge(s)...`);

  let allValid = true;
  const results: ValidationResult[] = [];

  for (const path of challengePaths) {
    const result = validateChallenge(path);
    results.push(result);
    printResult(result);
    if (!result.valid) {
      allValid = false;
    }
  }

  // Summary
  log(`\n${colors.bold}Summary${colors.reset}`);
  log(`─────────────────────────`);

  const validCount = results.filter(r => r.valid).length;
  const invalidCount = results.filter(r => !r.valid).length;
  const warningCount = results.reduce((sum, r) => sum + r.warnings.length, 0);
  const errorCount = results.reduce((sum, r) => sum + r.errors.length, 0);

  log(`  Valid:    ${validCount}/${results.length}`, validCount === results.length ? colors.green : colors.yellow);
  log(`  Invalid:  ${invalidCount}`, invalidCount > 0 ? colors.red : colors.green);
  log(`  Warnings: ${warningCount}`, warningCount > 0 ? colors.yellow : colors.green);
  log(`  Errors:   ${errorCount}`, errorCount > 0 ? colors.red : colors.green);

  process.exit(allValid ? 0 : 1);
}

main();
