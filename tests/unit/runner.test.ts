import { describe, it, expect } from 'vitest';
import { buildDockerExecCommand } from '../../src/lib/runner.js';

describe('buildDockerExecCommand', () => {
  it('wraps container and command in single quotes', () => {
    const result = buildDockerExecCommand('ls -la', 'gatekeeper-kali-1');
    expect(result).toBe("docker exec 'gatekeeper-kali-1' bash -c 'ls -la'");
  });

  it('escapes single quotes in containerName', () => {
    const result = buildDockerExecCommand('id', "evil'name");
    expect(result).toBe("docker exec 'evil'\\''name' bash -c 'id'");
  });

  it('escapes single quotes in command text', () => {
    const result = buildDockerExecCommand("echo 'hello'", 'kali');
    expect(result).toBe("docker exec 'kali' bash -c 'echo '\\''hello'\\'''");
  });

  it('prevents containerName shell-breakout patterns from becoming bare tokens', () => {
    const result = buildDockerExecCommand('ls -la', "test'; rm -rf /tmp/test; echo 'foo\"");
    expect(result).toContain("docker exec 'test'\\''; rm -rf /tmp/test; echo '\\''foo\"' bash -c 'ls -la'");
    expect(result).not.toContain("docker exec test';");
  });
});
