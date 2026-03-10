/**
 * OASIS Container Lifecycle Manager
 * Handles pulling images, creating networks, running containers,
 * health-checking, and cleanup for both registry and local modes.
 */

import { execFileSync } from 'child_process';
import { DOCKER_WAIT_TIMEOUT } from './constants.js';

export interface ContainerSpec {
  challengeId: string;
  targetImage: string;
  kaliImage: string;
  network: string;
  kaliContainerName: string;
  targetContainerName: string;
}

/** Synchronous sleep that works cross-platform (no shell, no `sleep` binary). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
    execFileSync('docker', ['pull', image], {
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
  execFileSync('docker', ['pull', '--platform', 'linux/amd64', image], {
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
    execFileSync('docker', ['network', 'inspect', name], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch {
    execFileSync('docker', ['network', 'create', name], {
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

  // Start target container
  const targetArgs = ['run', '-d'];
  if (platforms?.target) targetArgs.push('--platform', platforms.target);
  targetArgs.push('--name', spec.targetContainerName);
  targetArgs.push('--hostname', 'target');
  targetArgs.push('--network', spec.network);
  targetArgs.push(spec.targetImage);
  execFileSync('docker', targetArgs, { stdio: 'pipe', encoding: 'utf-8' });

  // Start kali container
  const kaliArgs = ['run', '-d'];
  if (platforms?.kali) kaliArgs.push('--platform', platforms.kali);
  kaliArgs.push('--name', spec.kaliContainerName);
  kaliArgs.push('--hostname', 'kali');
  kaliArgs.push('--network', spec.network);
  kaliArgs.push(spec.kaliImage, 'sleep', 'infinity');
  execFileSync('docker', kaliArgs, { stdio: 'pipe', encoding: 'utf-8' });
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

  while (Date.now() - start < timeoutMs) {
    try {
      execFileSync(
        'docker', ['exec', kaliContainer, 'curl', '-sf', targetUrl],
        { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
      );
      return; // Success
    } catch {
      // Not ready yet — wait and retry
      sleepSync(2000);
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
    execFileSync(
      'docker', ['rm', '-f', spec.targetContainerName, spec.kaliContainerName],
      { stdio: 'pipe', encoding: 'utf-8' }
    );
  } catch {
    // Containers may not exist
  }

  try {
    execFileSync('docker', ['network', 'rm', spec.network], {
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
    execFileSync(
      'docker', ['rm', '-f', spec.targetContainerName, spec.kaliContainerName],
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
  execFileSync('docker', ['compose', '-f', `${challengeDir}/docker-compose.yml`, 'up', '-d', '--build'], {
    stdio: 'inherit',
    encoding: 'utf-8',
  });
}

/**
 * Stop and remove containers from a docker-compose.yml in the given directory.
 */
export function stopFromCompose(challengeDir: string): void {
  execFileSync('docker', ['compose', '-f', `${challengeDir}/docker-compose.yml`, 'down'], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });
}
