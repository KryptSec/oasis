/**
 * OASIS Environment Pre-flight Checks
 * Validates Docker, containers, and connectivity before running benchmarks.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

export interface EnvCheckResult {
  ok: boolean;
  errors: string[];
  hints: string[];
}

const REQUIRED_KALI_TOOLS = ['curl', 'wget', 'python3'];

/**
 * Check if Docker daemon is running.
 */
export function checkDockerRunning(): EnvCheckResult {
  const errors: string[] = [];
  const hints: string[] = [];

  try {
    execSync('docker ps', { encoding: 'utf-8', stdio: 'pipe' });
    return { ok: true, errors: [], hints: [] };
  } catch {
    errors.push('Docker is not running or not accessible');
    hints.push('Start Docker Desktop (or your Docker daemon) and try again');
    hints.push('Verify with: docker ps');
    return { ok: false, errors, hints };
  }
}

/**
 * Check if challenge containers are running.
 * Expects containers: {challengeId}-target-1 and {challengeId}-kali-1
 */
export function checkContainersRunning(
  challengeId: string,
  containerName: string
): EnvCheckResult {
  const errors: string[] = [];
  const hints: string[] = [];

  const targetContainer = `${challengeId}-target-1`;
  const kaliContainer = containerName; // e.g. gatekeeper-kali-1

  try {
    const out = execSync(
      `docker ps -a --format "{{.Names}}\t{{.Status}}"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    const lines = out.trim().split('\n').filter(Boolean);
    const statusByNames = new Map<string, string>();
    for (const line of lines) {
      const [name, status] = line.split('\t');
      if (name) statusByNames.set(name, status || '');
    }

    const targetStatus = statusByNames.get(targetContainer);
    const kaliStatus = statusByNames.get(kaliContainer);

    if (!targetStatus) {
      errors.push(`Target container "${targetContainer}" not found`);
      hints.push(`Run: cd challenges/${challengeId} && docker-compose up -d`);
    } else if (!targetStatus.includes('Up')) {
      errors.push(`Target container "${targetContainer}" is not running (${targetStatus})`);
      hints.push('Check logs: docker logs ' + targetContainer);
      hints.push('Rebuild: cd challenges/' + challengeId + ' && docker-compose up -d --build');
    }

    if (!kaliStatus) {
      errors.push(`Kali container "${kaliContainer}" not found`);
      hints.push(`Run: cd challenges/${challengeId} && docker-compose up -d`);
    } else if (!kaliStatus.includes('Up')) {
      errors.push(`Kali container "${kaliContainer}" is not running (${kaliStatus})`);
      hints.push('Check logs: docker logs ' + kaliContainer);
      hints.push('Rebuild: cd challenges/' + challengeId + ' && docker-compose up -d --build');
    }

    return {
      ok: errors.length === 0,
      errors,
      hints,
    };
  } catch (e) {
    errors.push('Failed to check container status');
    hints.push('Ensure Docker is running: docker ps');
    return { ok: false, errors, hints };
  }
}

/**
 * Verify target is reachable from Kali container.
 */
export function checkTargetReachable(
  containerName: string,
  targetUrl: string
): EnvCheckResult {
  const errors: string[] = [];
  const hints: string[] = [];

  try {
    // Extract host:port from URL (e.g. http://target:5000 -> target:5000)
    const urlMatch = targetUrl.match(/^(?:https?:\/\/)?([^/]+)/);
    const hostPort = urlMatch ? urlMatch[1] : targetUrl.replace(/^https?:\/\//, '');

    const result = execSync(
      `docker exec ${containerName} curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${targetUrl}" 2>/dev/null || echo "FAIL"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    ).trim();

    if (result === 'FAIL' || result === '000') {
      errors.push(`Target ${targetUrl} is not reachable from Kali container`);
      hints.push('Ensure target container is running: docker ps');
      hints.push('The agent must use the exact target URL: ' + targetUrl);
      return { ok: false, errors, hints };
    }

    // Any 2xx, 3xx, 4xx, 5xx means we connected
    const code = parseInt(result, 10);
    if (isNaN(code) || code === 0) {
      errors.push(`Target ${targetUrl} connection failed (curl returned: ${result})`);
      return { ok: false, errors, hints };
    }

    return { ok: true, errors: [], hints: [] };
  } catch {
    errors.push(`Could not verify target reachability (curl may be missing in container)`);
    hints.push('Ensure Kali container has curl installed (see Dockerfile.kali)');
    return { ok: false, errors, hints };
  }
}

/**
 * Verify Kali container has required tools.
 */
export function checkKaliTools(containerName: string): EnvCheckResult {
  const errors: string[] = [];
  const hints: string[] = [];

  for (const tool of REQUIRED_KALI_TOOLS) {
    try {
      execSync(
        `docker exec ${containerName} which ${tool} 2>/dev/null`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
    } catch {
      errors.push(`Required tool "${tool}" not found in Kali container`);
    }
  }

  if (errors.length > 0) {
    hints.push('Rebuild Kali container with tools: cd challenges/<id> && docker-compose build --no-cache kali');
    hints.push('See Dockerfile.kali - it should install curl, wget, python3');
  }

  return {
    ok: errors.length === 0,
    errors,
    hints,
  };
}

/**
 * Validate that an API key is accepted by the provider.
 * Makes a minimal API call to catch bad keys before wasting time on setup.
 */
export async function checkApiKey(
  provider: string,
  apiKey: string,
  baseUrl?: string
): Promise<EnvCheckResult> {
  const errors: string[] = [];
  const hints: string[] = [];

  try {
    if (provider === 'anthropic') {
      // Minimal Anthropic API call — costs ~2 tokens
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey,
        ...(baseUrl && { baseURL: baseUrl }),
      });
      await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } else if (provider === 'ollama') {
      // No API key needed — skip
      return { ok: true, errors: [], hints: [] };
    } else {
      // OpenAI-compatible providers (openai, xai, google, custom)
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey, baseURL: baseUrl });
      await client.models.list();
    }

    return { ok: true, errors: [], hints: [] };
  } catch (error: any) {
    const status = error?.status ?? error?.statusCode ?? error?.response?.status;

    if (status === 401 || status === 403) {
      errors.push(`API key is invalid for ${provider}`);
      hints.push(`Verify your key and reconfigure:`);
      hints.push(`  oasis config set api-key ${provider} <your-key>`);
    } else {
      errors.push(`Could not validate API key for ${provider}: ${error?.message || 'Unknown error'}`);
      hints.push('Check your network connection and API endpoint');
      if (baseUrl) {
        hints.push(`API URL: ${baseUrl}`);
      }
    }

    return { ok: false, errors, hints };
  }
}

/**
 * Run all pre-flight checks for a local benchmark.
 */
export function runPreflightChecks(
  challengeId: string,
  challengeDir: string,
  containerName: string,
  targetUrl: string
): EnvCheckResult {
  const allErrors: string[] = [];
  const allHints: string[] = [];

  // 1. Docker running
  const dockerCheck = checkDockerRunning();
  if (!dockerCheck.ok) {
    return dockerCheck;
  }

  // 2. Containers running
  const containerCheck = checkContainersRunning(challengeId, containerName);
  if (!containerCheck.ok) {
    return containerCheck;
  }

  // 3. Target reachable
  const reachCheck = checkTargetReachable(containerName, targetUrl);
  if (!reachCheck.ok) {
    return reachCheck;
  }

  // 4. Kali tools
  const toolsCheck = checkKaliTools(containerName);
  if (!toolsCheck.ok) {
    return toolsCheck;
  }

  return { ok: true, errors: [], hints: [] };
}
