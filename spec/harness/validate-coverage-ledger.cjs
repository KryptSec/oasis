#!/usr/bin/env node

/**
 * OASIS Harness Coverage Ledger Validator
 * 
 * Zero-dependency Node.js validator for coverage-ledger.json.
 * Adapted from Cloudflare security-audit-skill validation patterns.
 * 
 * Usage:
 *   node validate-coverage-ledger.cjs <coverage-ledger.json>
 * 
 * Exit codes:
 *   0 - Valid
 *   1 - Invalid (schema violations or integrity errors)
 *   2 - File/parse error
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = '1.0.0';
const VALID_STATES = ['planned', 'in_progress', 'completed', 'deferred'];

function validate(ledgerPath) {
  const errors = [];
  
  // 1. Load and parse
  let ledger;
  try {
    const content = fs.readFileSync(ledgerPath, 'utf-8');
    ledger = JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to load/parse ${ledgerPath}: ${err.message}`);
    process.exit(2);
  }
  
  // 2. Top-level required fields
  if (ledger.version !== SCHEMA_VERSION) {
    errors.push(`version must be "${SCHEMA_VERSION}" (got "${ledger.version}")`);
  }
  
  if (!ledger.runId || typeof ledger.runId !== 'string') {
    errors.push('runId is required (string)');
  }
  
  if (!ledger.challenge || typeof ledger.challenge !== 'string') {
    errors.push('challenge is required (string)');
  }
  
  if (!ledger.timestamp || typeof ledger.timestamp !== 'string') {
    errors.push('timestamp is required (ISO 8601 string)');
  } else if (isNaN(Date.parse(ledger.timestamp))) {
    errors.push('timestamp must be valid ISO 8601 date-time');
  }
  
  if (!Array.isArray(ledger.units)) {
    errors.push('units must be an array');
    console.error(`❌ Validation failed: ${errors.length} error(s)\n`);
    errors.forEach(e => console.error(`  • ${e}`));
    process.exit(1);
  }
  
  // 3. Validate units
  const unitIds = new Set();
  const stateCounts = { planned: 0, in_progress: 0, completed: 0, deferred: 0 };
  
  ledger.units.forEach((unit, idx) => {
    const prefix = `units[${idx}]`;
    
    if (!unit.id || typeof unit.id !== 'string') {
      errors.push(`${prefix}.id is required (string)`);
    } else {
      if (unitIds.has(unit.id)) {
        errors.push(`${prefix}.id "${unit.id}" is duplicate`);
      }
      unitIds.add(unit.id);
    }
    
    if (!unit.name || typeof unit.name !== 'string') {
      errors.push(`${prefix}.name is required (string)`);
    }
    
    if (!unit.description || typeof unit.description !== 'string') {
      errors.push(`${prefix}.description is required (string)`);
    }
    
    if (!unit.surface || typeof unit.surface !== 'string') {
      errors.push(`${prefix}.surface is required (string)`);
    }
    
    if (!unit.state || !VALID_STATES.includes(unit.state)) {
      errors.push(`${prefix}.state must be one of: ${VALID_STATES.join(', ')}`);
    } else {
      stateCounts[unit.state]++;
    }
    
    if (!Array.isArray(unit.findingIds)) {
      errors.push(`${prefix}.findingIds must be an array`);
    }
    
    if (!Array.isArray(unit.techniques)) {
      errors.push(`${prefix}.techniques must be an array`);
    }
    
    // State-specific validations
    if (unit.state === 'in_progress' || unit.state === 'completed') {
      if (!unit.assignedTo) {
        errors.push(`${prefix}.assignedTo is required when state is "${unit.state}"`);
      }
      if (!unit.startedAt) {
        errors.push(`${prefix}.startedAt is required when state is "${unit.state}"`);
      } else if (isNaN(Date.parse(unit.startedAt))) {
        errors.push(`${prefix}.startedAt must be valid ISO 8601 date-time`);
      }
    }
    
    if (unit.state === 'completed') {
      if (!unit.completedAt) {
        errors.push(`${prefix}.completedAt is required when state is "completed"`);
      } else if (isNaN(Date.parse(unit.completedAt))) {
        errors.push(`${prefix}.completedAt must be valid ISO 8601 date-time`);
      }
    }
    
    if (unit.state === 'deferred') {
      if (!unit.deferredReason) {
        errors.push(`${prefix}.deferredReason is required when state is "deferred"`);
      }
    }
  });
  
  // 4. Validate summary matches counts
  if (!ledger.summary || typeof ledger.summary !== 'object') {
    errors.push('summary is required (object)');
  } else {
    if (ledger.summary.planned !== stateCounts.planned) {
      errors.push(`summary.planned (${ledger.summary.planned}) doesn't match actual count (${stateCounts.planned})`);
    }
    if (ledger.summary.inProgress !== stateCounts.in_progress) {
      errors.push(`summary.inProgress (${ledger.summary.inProgress}) doesn't match actual count (${stateCounts.in_progress})`);
    }
    if (ledger.summary.completed !== stateCounts.completed) {
      errors.push(`summary.completed (${ledger.summary.completed}) doesn't match actual count (${stateCounts.completed})`);
    }
    if (ledger.summary.deferred !== stateCounts.deferred) {
      errors.push(`summary.deferred (${ledger.summary.deferred}) doesn't match actual count (${stateCounts.deferred})`);
    }
  }
  
  // 5. Report results
  if (errors.length > 0) {
    console.error(`❌ Validation failed: ${errors.length} error(s)\n`);
    errors.forEach(e => console.error(`  • ${e}`));
    process.exit(1);
  }
  
  console.log(`✅ Valid coverage-ledger.json (${ledger.units.length} unit(s), version ${SCHEMA_VERSION})`);
  console.log(`   ${stateCounts.completed} completed, ${stateCounts.in_progress} in progress, ${stateCounts.planned} planned, ${stateCounts.deferred} deferred`);
  process.exit(0);
}

// Main
if (process.argv.length !== 3) {
  console.error('Usage: node validate-coverage-ledger.cjs <coverage-ledger.json>');
  process.exit(2);
}

const ledgerPath = path.resolve(process.argv[2]);
if (!fs.existsSync(ledgerPath)) {
  console.error(`❌ File not found: ${ledgerPath}`);
  process.exit(2);
}

validate(ledgerPath);
