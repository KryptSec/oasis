#!/usr/bin/env node

/**
 * OASIS Harness Findings Validator
 * 
 * Zero-dependency Node.js validator for findings.json conformance to findings-schema.json.
 * Adapted from Cloudflare security-audit-skill validation patterns.
 * 
 * Usage:
 *   node validate-findings.cjs <findings.json>
 * 
 * Exit codes:
 *   0 - Valid
 *   1 - Invalid (schema violations)
 *   2 - File/parse error
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = '1.0.0';

const VALID_VERDICTS = ['confirmed', 'needs_validation', 'rejected'];
const VALID_CATEGORIES = [
  'sql-injection',
  'command-injection',
  'auth-bypass',
  'idor',
  'xxe',
  'ssrf',
  'path-traversal',
  'deserialization',
  'crypto-failure',
  'jwt-forgery',
  'session-hijack',
  'info-disclosure',
  'privilege-escalation',
  'rce',
  'other',
];
const VALID_CONFIDENCE = ['low', 'medium', 'high'];
const VALID_SEVERITY = ['informational', 'low', 'medium', 'high', 'critical'];
const VALID_HARNESS_MODES = ['single-model', 'kbot-fleet'];

function validate(findingsPath) {
  const errors = [];
  
  // 1. Load and parse
  let findings;
  try {
    const content = fs.readFileSync(findingsPath, 'utf-8');
    findings = JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to load/parse ${findingsPath}: ${err.message}`);
    process.exit(2);
  }
  
  // 2. Top-level required fields
  if (findings.version !== SCHEMA_VERSION) {
    errors.push(`version must be "${SCHEMA_VERSION}" (got "${findings.version}")`);
  }
  
  if (!findings.runId || typeof findings.runId !== 'string') {
    errors.push('runId is required (string)');
  }
  
  if (!findings.challenge || typeof findings.challenge !== 'string') {
    errors.push('challenge is required (string)');
  }
  
  if (!findings.timestamp || typeof findings.timestamp !== 'string') {
    errors.push('timestamp is required (ISO 8601 string)');
  } else if (isNaN(Date.parse(findings.timestamp))) {
    errors.push('timestamp must be valid ISO 8601 date-time');
  }
  
  if (!findings.harnessMode || !VALID_HARNESS_MODES.includes(findings.harnessMode)) {
    errors.push(`harnessMode must be one of: ${VALID_HARNESS_MODES.join(', ')}`);
  }
  
  if (!Array.isArray(findings.findings)) {
    errors.push('findings must be an array');
    console.error(`❌ Validation failed: ${errors.length} error(s)\n`);
    errors.forEach(e => console.error(`  • ${e}`));
    process.exit(1);
  }
  
  // 3. No extra top-level properties (additionalProperties: false)
  const allowedTopLevel = ['version', 'runId', 'challenge', 'timestamp', 'harnessMode', 'findings'];
  for (const key of Object.keys(findings)) {
    if (!allowedTopLevel.includes(key)) {
      errors.push(`Unexpected top-level property: "${key}"`);
    }
  }
  
  // 4. Validate each finding
  findings.findings.forEach((finding, idx) => {
    const prefix = `findings[${idx}]`;
    
    if (!finding.id || typeof finding.id !== 'string') {
      errors.push(`${prefix}.id is required (string)`);
    }
    
    if (!finding.verdict || !VALID_VERDICTS.includes(finding.verdict)) {
      errors.push(`${prefix}.verdict must be one of: ${VALID_VERDICTS.join(', ')}`);
    }
    
    if (!finding.title || typeof finding.title !== 'string') {
      errors.push(`${prefix}.title is required (string)`);
    }
    
    if (!finding.category || !VALID_CATEGORIES.includes(finding.category)) {
      errors.push(`${prefix}.category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
    
    // Verdict-specific validation
    if (finding.verdict === 'confirmed') {
      validateConfirmedFinding(finding, prefix, errors);
    } else if (finding.verdict === 'needs_validation') {
      validateNeedsValidationFinding(finding, prefix, errors);
    } else if (finding.verdict === 'rejected') {
      validateRejectedFinding(finding, prefix, errors);
    }
  });
  
  // 5. Report results
  if (errors.length > 0) {
    console.error(`❌ Validation failed: ${errors.length} error(s)\n`);
    errors.forEach(e => console.error(`  • ${e}`));
    process.exit(1);
  }
  
  console.log(`✅ Valid findings.json (${findings.findings.length} finding(s), version ${SCHEMA_VERSION})`);
  console.log(`   ${findings.findings.filter(f => f.verdict === 'confirmed').length} confirmed, ${findings.findings.filter(f => f.verdict === 'needs_validation').length} needs_validation, ${findings.findings.filter(f => f.verdict === 'rejected').length} rejected`);
  process.exit(0);
}

function validateConfirmedFinding(finding, prefix, errors) {
  const required = [
    'id', 'verdict', 'title', 'category', 'owaspCategory', 'trace',
    'execution', 'intendedBehavior', 'confidence', 'severity',
    'remediation', 'verifiedBy', 'verifiedAt'
  ];
  
  for (const field of required) {
    if (!(field in finding)) {
      errors.push(`${prefix}.${field} is required for confirmed findings`);
    }
  }
  
  // trace
  if (finding.trace) {
    if (!Array.isArray(finding.trace.steps) || finding.trace.steps.length === 0) {
      errors.push(`${prefix}.trace.steps must be non-empty array of numbers`);
    }
    if (!Array.isArray(finding.trace.commands) || finding.trace.commands.length === 0) {
      errors.push(`${prefix}.trace.commands must be non-empty array of strings`);
    }
    const allowedTrace = ['steps', 'commands', 'endpoints'];
    for (const key of Object.keys(finding.trace)) {
      if (!allowedTrace.includes(key)) {
        errors.push(`${prefix}.trace has unexpected property: "${key}"`);
      }
    }
  }
  
  // execution
  if (finding.execution) {
    if (!finding.execution.payload || typeof finding.execution.payload !== 'string') {
      errors.push(`${prefix}.execution.payload is required (string)`);
    }
    if (!finding.execution.proofOutput || typeof finding.execution.proofOutput !== 'string') {
      errors.push(`${prefix}.execution.proofOutput is required (string)`);
    }
    const allowedExec = ['payload', 'method', 'proofOutput'];
    for (const key of Object.keys(finding.execution)) {
      if (!allowedExec.includes(key)) {
        errors.push(`${prefix}.execution has unexpected property: "${key}"`);
      }
    }
  }
  
  // confidence
  if (finding.confidence) {
    if (!VALID_CONFIDENCE.includes(finding.confidence.level)) {
      errors.push(`${prefix}.confidence.level must be one of: ${VALID_CONFIDENCE.join(', ')}`);
    }
    if (!finding.confidence.reason || typeof finding.confidence.reason !== 'string') {
      errors.push(`${prefix}.confidence.reason is required (string)`);
    }
    const allowedConf = ['level', 'reason'];
    for (const key of Object.keys(finding.confidence)) {
      if (!allowedConf.includes(key)) {
        errors.push(`${prefix}.confidence has unexpected property: "${key}"`);
      }
    }
  }
  
  // severity
  if (finding.severity) {
    if (!VALID_SEVERITY.includes(finding.severity.likelihood)) {
      errors.push(`${prefix}.severity.likelihood must be one of: ${VALID_SEVERITY.join(', ')}`);
    }
    if (!VALID_SEVERITY.includes(finding.severity.impact)) {
      errors.push(`${prefix}.severity.impact must be one of: ${VALID_SEVERITY.join(', ')}`);
    }
    if (!VALID_SEVERITY.includes(finding.severity.overallSeverity)) {
      errors.push(`${prefix}.severity.overallSeverity must be one of: ${VALID_SEVERITY.join(', ')}`);
    }
    const allowedSev = ['likelihood', 'impact', 'overallSeverity'];
    for (const key of Object.keys(finding.severity)) {
      if (!allowedSev.includes(key)) {
        errors.push(`${prefix}.severity has unexpected property: "${key}"`);
      }
    }
  }
  
  // verifiedAt date
  if (finding.verifiedAt && isNaN(Date.parse(finding.verifiedAt))) {
    errors.push(`${prefix}.verifiedAt must be valid ISO 8601 date-time`);
  }
  
  // No extra properties
  const allowedConfirmed = [
    'id', 'verdict', 'title', 'category', 'owaspCategory', 'trace',
    'execution', 'intendedBehavior', 'confidence', 'severity',
    'remediation', 'verifiedBy', 'verifiedAt'
  ];
  for (const key of Object.keys(finding)) {
    if (!allowedConfirmed.includes(key)) {
      errors.push(`${prefix} has unexpected property: "${key}"`);
    }
  }
}

function validateNeedsValidationFinding(finding, prefix, errors) {
  const required = ['id', 'verdict', 'title', 'category', 'trace', 'reason', 'discoveredBy'];
  
  for (const field of required) {
    if (!(field in finding)) {
      errors.push(`${prefix}.${field} is required for needs_validation findings`);
    }
  }
  
  if (finding.trace && (!Array.isArray(finding.trace.steps) || finding.trace.steps.length === 0)) {
    errors.push(`${prefix}.trace.steps must be non-empty array`);
  }
  
  const allowed = ['id', 'verdict', 'title', 'category', 'owaspCategory', 'trace', 'reason', 'discoveredBy'];
  for (const key of Object.keys(finding)) {
    if (!allowed.includes(key)) {
      errors.push(`${prefix} has unexpected property: "${key}"`);
    }
  }
}

function validateRejectedFinding(finding, prefix, errors) {
  const required = ['id', 'verdict', 'title', 'category', 'reason', 'rejectedBy', 'rejectedAt'];
  
  for (const field of required) {
    if (!(field in finding)) {
      errors.push(`${prefix}.${field} is required for rejected findings`);
    }
  }
  
  if (finding.rejectedAt && isNaN(Date.parse(finding.rejectedAt))) {
    errors.push(`${prefix}.rejectedAt must be valid ISO 8601 date-time`);
  }
  
  const allowed = ['id', 'verdict', 'title', 'category', 'reason', 'rejectedBy', 'rejectedAt'];
  for (const key of Object.keys(finding)) {
    if (!allowed.includes(key)) {
      errors.push(`${prefix} has unexpected property: "${key}"`);
    }
  }
}

// Main
if (process.argv.length !== 3) {
  console.error('Usage: node validate-findings.cjs <findings.json>');
  process.exit(2);
}

const findingsPath = path.resolve(process.argv[2]);
if (!fs.existsSync(findingsPath)) {
  console.error(`❌ File not found: ${findingsPath}`);
  process.exit(2);
}

validate(findingsPath);
