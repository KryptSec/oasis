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

export interface PullRetryOptions {
  /** Max attempts for a transient failure (default 3). */
  maxAttempts?: number;
  /** Base delay for exponential backoff, in ms (default 5000). */
  baseDelayMs?: number;
  /** Called between retries so callers can surface progress. */
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number, reason: string) => void;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => void;
}

/** Default attempt count for transient registry failures. */
export const DOCKER_PULL_MAX_ATTEMPTS = 3;
/** Default backoff base for transient registry failures. */
export const DOCKER_PULL_BASE_DELAY_MS = 5_000;

/**
 * Classify a docker pull failure.
 *  - 'manifest'  -> image has no native-platform manifest; retry with linux/amd64
 *  - 'transient' -> registry/network hiccup; worth retrying the same command
 *  - 'fatal'     -> auth/not-found/etc; retrying will not help
 */
export function classifyPullError(err: unknown): 'manifest' | 'transient' | 'fatal' {
  const eObj = err != null && typeof err === 'object' ? err as Record<string, unknown> : {};
  const msg = String(eObj.stderr || eObj.message || '');

  if (msg.includes('no matching manifest') || msg.includes('no match for platform')) {
    return 'manifest';
  }

  const transientSignals = [
    '503', 'Service Unavailable',
    '502', 'Bad Gateway',
    '504', 'Gateway Time-out', 'Gateway Timeout',
    '429', 'Too Many Requests', 'toomanyrequests',
    'connection refused', 'connection reset',
    'TLS handshake timeout', 'i/o timeout',
    'context deadline exceeded',
    'unexpected EOF', 'EOF',
    'temporary failure',
  ];
  if (transientSignals.some(s => msg.includes(s))) {
    return 'transient';
  }

  return 'fatal';
}

/** Run a docker image pull once. Throws the raw error on failure. */
function dockerPullOnce(image: string, platform?: string, onProgress?: (line: string) => void): void {
  const args = ['pull'];
  if (platform) args.push('--platform', platform);
  args.push(image);
  execFileSync('docker', args, {
    stdio: onProgress ? 'inherit' : 'pipe',
    encoding: 'utf-8',
  });
}

/**
 * Pull a Docker image, retrying transient registry failures and falling back to
 * linux/amd64 when the image has no native manifest (common for challenge images
 * on Apple Silicon).
 *
 * Retries cover the flaky-registry cases that otherwise abort a benchmark
 * mid-setup: 5xx from Docker Hub, rate limiting, and network timeouts. Errors
 * that cannot succeed on retry (auth failures, missing repos) fail fast so a bad
 * image reference is not hammered three times.
 *
 * Returns true if the amd64 fallback was used.
 */
export function pullImage(
  image: string,
  onProgress?: (line: string) => void,
  options: PullRetryOptions = {},
): boolean {
  const maxAttempts = options.maxAttempts ?? DOCKER_PULL_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DOCKER_PULL_BASE_DELAY_MS;
  const sleep = options.sleep ?? sleepSync;

  if (onProgress) {
    onProgress(`Pulling ${image}...`);
  }

  // --- Phase 1: native platform pull, retrying transient failures ---
  let nativeErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      dockerPullOnce(image, undefined, onProgress);
      return false;
    } catch (err) {
      const kind = classifyPullError(err);

      if (kind === 'manifest') {
        nativeErr = err;
        break; // fall through to the amd64 fallback below
      }
      if (kind === 'fatal') {
        throw err;
      }

      nativeErr = err;
      if (attempt === maxAttempts) break;

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      options.onRetry?.(attempt, maxAttempts, delayMs, String(err instanceof Error ? err.message : err));
      if (onProgress) {
        onProgress(`Pull failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs / 1000}s...`);
      }
      sleep(delayMs);
    }
  }

  // Exhausted retries on a transient error: surface it rather than masking the
  // real cause behind a platform fallback.
  if (nativeErr && classifyPullError(nativeErr) === 'transient') {
    throw nativeErr;
  }

  // --- Phase 2: linux/amd64 fallback (no-matching-manifest case) ---
  if (onProgress) {
    onProgress(`Pulling ${image} (linux/amd64 fallback)...`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      dockerPullOnce(image, 'linux/amd64', onProgress);
      return true;
    } catch (err) {
      const kind = classifyPullError(err);
      if (kind === 'fatal' || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      options.onRetry?.(attempt, maxAttempts, delayMs, String(err instanceof Error ? err.message : err));
      if (onProgress) {
        onProgress(`Pull failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs / 1000}s...`);
      }
      sleep(delayMs);
    }
  }

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
  const targetFallback = pullImage(spec.targetImage, onProgress ? (m) => onProgress(m) : undefined, {
    onRetry: (attempt, max, delay, reason) =>
      onProgress?.(`Retrying ${spec.targetImage} (${attempt}/${max}) in ${delay / 1000}s: ${reason}`),
  });
  onProgress?.(`Pulling ${spec.kaliImage}...`);
  const kaliFallback = pullImage(spec.kaliImage, onProgress ? (m) => onProgress(m) : undefined, {
    onRetry: (attempt, max, delay, reason) =>
      onProgress?.(`Retrying ${spec.kaliImage} (${attempt}/${max}) in ${delay / 1000}s: ${reason}`),
  });

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
