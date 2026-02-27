/**
 * OASIS Container Lifecycle Manager
 * Handles pulling images, creating networks, running containers,
 * health-checking, and cleanup for both registry and local modes.
 */

import { execSync } from 'child_process';
import { shellEscape } from './shell.js';
import { DOCKER_WAIT_TIMEOUT, DOCKER_POLL_INTERVAL } from './constants.js';

export interface ContainerSpec {
  challengeId: string;
  targetImage: string;
  kaliImage: string;
  network: string;
  kaliContainerName: string;
  targetContainerName: string;
}

/**
 * Pull a Docker image. Tries native platform first, falls back to linux/amd64
 * if the image has no matching manifest (common for challenge images on Apple Silicon).
 * Returns true if the amd64 fallback was used.
 */
export function pullImage(image: string, onProgress?: (line: string) => void): boolean {
  if (onProgress) {
    onProgress(`Pulling ${image}...`);
  }

  try {
    execSync(`docker pull ${shellEscape(image)}`, {
      stdio: onProgress ? 'inherit' : 'pipe',
      encoding: 'utf-8',
    });
    return false;
  } catch (err: unknown) {
    const eObj = err != null && typeof err === 'object' ? err as Record<string, unknown> : {};
    const msg = String(eObj.stderr || eObj.message || '');
    if (!msg.includes('no matching manifest') && !msg.includes('no match for platform')) {
      throw err;
    }
  }

  // Fallback: pull with explicit amd64 platform
  if (onProgress) {
    onProgress(`Pulling ${image} (linux/amd64 fallback)...`);
  }
  execSync(`docker pull --platform linux/amd64 ${shellEscape(image)}`, {
    stdio: onProgress ? 'inherit' : 'pipe',
    encoding: 'utf-8',
  });
  return true;
}

/**
 * Ensure a Docker network exists, creating it if necessary.
 */
export function ensureNetwork(name: string): void {
  try {
    execSync(`docker network inspect ${shellEscape(name)}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch {
    execSync(`docker network create ${shellEscape(name)}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  }
}

export interface PlatformOverrides {
  target?: string;
  kali?: string;
}

/**
 * Start containers from a ContainerSpec using docker run.
 * Cleans up stale containers first, ensures the network, then runs both.
 * Pass per-image platform overrides so only images that need emulation run under it.
 */
export function startContainers(spec: ContainerSpec, platforms?: PlatformOverrides): void {
  cleanupStale(spec);
  ensureNetwork(spec.network);

  const targetPlatformFlag = platforms?.target ? `--platform ${shellEscape(platforms.target)} ` : '';
  const kaliPlatformFlag = platforms?.kali ? `--platform ${shellEscape(platforms.kali)} ` : '';

  // Start target container
  execSync(
    `docker run -d ${targetPlatformFlag}--name ${shellEscape(spec.targetContainerName)} ` +
    `--hostname target --network ${shellEscape(spec.network)} ` +
    `${shellEscape(spec.targetImage)}`,
    { stdio: 'pipe', encoding: 'utf-8' }
  );

  // Start kali container
  execSync(
    `docker run -d ${kaliPlatformFlag}--name ${shellEscape(spec.kaliContainerName)} ` +
    `--hostname kali --network ${shellEscape(spec.network)} ` +
    `${shellEscape(spec.kaliImage)} sleep infinity`,
    { stdio: 'pipe', encoding: 'utf-8' }
  );
}

/**
 * Pull images and start containers for a registry challenge.
 * Tracks per-image ARM64 fallback so only images that lack a native manifest run under emulation.
 */
export function pullAndStartContainers(
  spec: ContainerSpec,
  onProgress?: (msg: string) => void,
): void {
  onProgress?.(`Pulling ${spec.targetImage}...`);
  const targetFallback = pullImage(spec.targetImage);
  onProgress?.(`Pulling ${spec.kaliImage}...`);
  const kaliFallback = pullImage(spec.kaliImage);

  const platforms: PlatformOverrides = {};
  if (targetFallback) platforms.target = 'linux/amd64';
  if (kaliFallback) platforms.kali = 'linux/amd64';

  onProgress?.('Starting containers...');
  startContainers(spec, (targetFallback || kaliFallback) ? platforms : undefined);
}

/**
 * Wait for the target to be reachable from the kali container.
 * Polls with curl every 2 seconds until success or timeout.
 */
export function waitForTarget(
  kaliContainer: string,
  targetUrl: string,
  timeoutMs = DOCKER_WAIT_TIMEOUT
): void {
  const start = Date.now();
  const pollInterval = DOCKER_POLL_INTERVAL;

  while (Date.now() - start < timeoutMs) {
    try {
      execSync(
        `docker exec ${shellEscape(kaliContainer)} curl -sf ${shellEscape(targetUrl)}`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
      );
      return; // Success
    } catch {
      // Not ready yet — wait and retry
      execSync(`sleep 2`, { stdio: 'pipe' });
    }
  }

  throw new Error(
    `Target ${targetUrl} not reachable from ${kaliContainer} after ${timeoutMs / 1000}s`
  );
}

/**
 * Remove containers and network for a spec. Ignores errors (containers may not exist).
 */
export function cleanup(spec: ContainerSpec): void {
  try {
    execSync(
      `docker rm -f ${shellEscape(spec.targetContainerName)} ${shellEscape(spec.kaliContainerName)}`,
      { stdio: 'pipe', encoding: 'utf-8' }
    );
  } catch {
    // Containers may not exist
  }

  try {
    execSync(`docker network rm ${shellEscape(spec.network)}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch {
    // Network may be shared or already removed
  }
}

/**
 * Remove stale containers (if they exist) before starting fresh ones.
 */
export function cleanupStale(spec: ContainerSpec): void {
  try {
    execSync(
      `docker rm -f ${shellEscape(spec.targetContainerName)} ${shellEscape(spec.kaliContainerName)} 2>/dev/null`,
      { stdio: 'pipe', encoding: 'utf-8' }
    );
  } catch {
    // Ignore — containers may not exist
  }
}

/**
 * Start containers from a docker-compose.yml in the given directory.
 */
export function startFromCompose(challengeDir: string): void {
  execSync(`docker compose -f ${shellEscape(challengeDir)}/docker-compose.yml up -d --build`, {
    stdio: 'inherit',
    encoding: 'utf-8',
  });
}

/**
 * Stop and remove containers from a docker-compose.yml in the given directory.
 */
export function stopFromCompose(challengeDir: string): void {
  execSync(`docker compose -f ${shellEscape(challengeDir)}/docker-compose.yml down`, {
    stdio: 'pipe',
    encoding: 'utf-8',
  });
}
