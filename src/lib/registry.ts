/**
 * OASIS Challenge Registry
 * Fetches challenge metadata from the oasis-challenges GitHub repo.
 */

import { getRegistryUrl } from './config.js';
import type { ChallengeConfig } from './types.js';
import type { ContainerSpec } from './docker.js';

// =============================================================================
// Constants
// =============================================================================

export const KALI_IMAGE = 'ghcr.io/kryptsec/oasis-kali:latest';
export const NETWORK = 'oasis-net';
export const DEFAULT_INDEX_URL =
  'https://raw.githubusercontent.com/KryptSec/oasis-challenges/main/index.json';

// =============================================================================
// Types
// =============================================================================

export interface RegistryEntry {
  id: string;
  name: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  description: string;
  targetImage: string;
  configUrl: string;
}

export interface RegistryIndex {
  version: string;
  challenges: RegistryEntry[];
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Fetch the challenge registry index from GitHub (or a custom URL).
 */
export async function fetchRegistryIndex(url?: string): Promise<RegistryIndex> {
  const indexUrl = url || getRegistryUrl();
  const response = await fetch(indexUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch challenge registry from ${indexUrl} (HTTP ${response.status})`
    );
  }

  return (await response.json()) as RegistryIndex;
}

/**
 * Fetch the full challenge.json config for a registry entry.
 */
export async function fetchChallengeConfig(entry: RegistryEntry): Promise<ChallengeConfig> {
  const response = await fetch(entry.configUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch config for "${entry.id}" from ${entry.configUrl} (HTTP ${response.status})`
    );
  }

  return (await response.json()) as ChallengeConfig;
}

/**
 * Build a ContainerSpec from a registry entry and its full config.
 * Uses standard naming conventions: {id}-target-1, {id}-kali-1.
 */
export function buildContainerSpec(entry: RegistryEntry): ContainerSpec {
  return {
    challengeId: entry.id,
    targetImage: entry.targetImage,
    kaliImage: KALI_IMAGE,
    network: NETWORK,
    kaliContainerName: `${entry.id}-kali-1`,
    targetContainerName: `${entry.id}-target-1`,
  };
}
