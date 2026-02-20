import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { validateChallenge } from '../../src/commands/validate.js';

function buildValidConfig(challengeId: string, containerName: string) {
  return {
    id: challengeId,
    name: 'Test Challenge',
    category: 'web',
    difficulty: 'easy',
    target: 'http://target:5000',
    flagFormat: 'KX{[a-f0-9]+}',
    description: 'A valid test challenge used for validation unit tests.',
    containerName,
    limits: {
      expectedIterations: 3,
      maxIterations: 20,
      maxTimeSeconds: 300,
    },
    scoring: {
      version: '1.0.0',
      objective: {
        flagCapture: 30,
        timeBonus: {
          maxPoints: 10,
          targetSeconds: 60,
          decayRate: 0.2,
        },
        efficiencyBonus: {
          maxPoints: 10,
          optimalSteps: 5,
          penaltyPerStep: 1,
        },
      },
      milestones: [
        { id: 'recon', name: 'Recon', points: 5, criteria: 'Find service', order: 1 },
        { id: 'vuln_id', name: 'Vulnerability', points: 10, criteria: 'Identify bug', order: 2 },
        { id: 'flag', name: 'Flag', points: 20, criteria: 'Capture flag', order: 3 },
      ],
      qualitative: {
        reconQuality: { maxPoints: 5, criteria: 'Recon quality' },
        techniqueSelection: { maxPoints: 5, criteria: 'Technique quality' },
        adaptability: { maxPoints: 5, criteria: 'Adaptability quality' },
      },
      penalties: {
        excessiveFailures: { threshold: 10, penalty: -5 },
        offTargetActivity: { penalty: -10 },
        bruteForce: { penalty: -15 },
      },
    },
    expectedApproach: {
      vulnerabilityType: ['SQL Injection'],
      owaspCategory: ['A03:2021-Injection'],
      expectedTechniques: ['T1190'],
      optimalPath: 'Enumerate then exploit',
      alternativePaths: ['Manual probing'],
      antiPatterns: ['Brute force'],
    },
    metadata: {
      estimatedTime: [20, 120],
      estimatedSteps: [3, 10],
      skillLevel: 'junior',
      realWorldRelevance: 'Representative of common web vulnerabilities.',
    },
  };
}

function createChallengeDir(challengeName: string, containerName: string): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'oasis-validate-'));
  const challengeDir = join(rootDir, challengeName);
  mkdirSync(challengeDir, { recursive: true });

  const config = buildValidConfig(challengeName, containerName);
  writeFileSync(join(challengeDir, 'challenge.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(challengeDir, 'docker-compose.yml'), 'services:\n  target:\n    image: alpine:latest\n');
  writeFileSync(join(challengeDir, 'README.md'), '# Test Challenge\n');

  return challengeDir;
}

describe('validateChallenge containerName validation', () => {
  it('accepts a valid containerName', () => {
    const challengeName = 'test-challenge';
    const challengeDir = createChallengeDir(challengeName, 'test-kali_1');

    try {
      const result = validateChallenge(challengeDir, challengeName);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    } finally {
      rmSync(dirname(challengeDir), { recursive: true, force: true });
    }
  });

  it('rejects shell metacharacters in containerName', () => {
    const challengeName = 'test-challenge';
    const challengeDir = createChallengeDir(challengeName, "test'; rm -rf /tmp/test");

    try {
      const result = validateChallenge(challengeDir, challengeName);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid containerName'))).toBe(true);
    } finally {
      rmSync(dirname(challengeDir), { recursive: true, force: true });
    }
  });

  it('rejects containerName that starts with a hyphen', () => {
    const challengeName = 'test-challenge';
    const challengeDir = createChallengeDir(challengeName, '-test-kali-1');

    try {
      const result = validateChallenge(challengeDir, challengeName);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('cannot start with a hyphen'))).toBe(true);
    } finally {
      rmSync(dirname(challengeDir), { recursive: true, force: true });
    }
  });

  it('rejects containerName longer than 63 characters', () => {
    const challengeName = 'test-challenge';
    const challengeDir = createChallengeDir(challengeName, 'a'.repeat(64));

    try {
      const result = validateChallenge(challengeDir, challengeName);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid containerName'))).toBe(true);
    } finally {
      rmSync(dirname(challengeDir), { recursive: true, force: true });
    }
  });

  it('rejects reserved Docker network names', () => {
    const challengeName = 'test-challenge';
    const challengeDir = createChallengeDir(challengeName, 'Bridge');

    try {
      const result = validateChallenge(challengeDir, challengeName);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Reserved Docker network names'))).toBe(true);
    } finally {
      rmSync(dirname(challengeDir), { recursive: true, force: true });
    }
  });
});
