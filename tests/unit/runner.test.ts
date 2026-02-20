import { describe, it, expect } from 'vitest';
import { buildDockerExecInvocation } from '../../src/lib/runner.js';

describe('buildDockerExecInvocation', () => {
  it('uses docker exec with stdin script mode (no bash -c)', () => {
    const invocation = buildDockerExecInvocation('ls -la', 'gatekeeper-kali-1');

    expect(invocation.command).toBe('docker');
    expect(invocation.args).toEqual(['exec', '-i', 'gatekeeper-kali-1', 'bash']);
    expect(invocation.args).not.toContain('-c');
    expect(invocation.input).toBe('ls -la');
  });

  it('preserves edge-case shell characters in command input', () => {
    const edgeCases = [
      'echo `whoami`',
      'echo $(date)',
      'echo $USER',
      'echo "test\\ntest"',
      'echo \\\\$escaped',
      'printf "line1\\nline2\\n"',
    ];

    for (const command of edgeCases) {
      const invocation = buildDockerExecInvocation(command, 'kali');
      expect(invocation.input).toBe(command);
    }
  });

  it('passes containerName as argv token instead of shell interpolation', () => {
    const maliciousContainer = "test'; rm -rf /tmp/test; echo 'foo\"";
    const invocation = buildDockerExecInvocation('id', maliciousContainer);
    expect(invocation.args[2]).toBe(maliciousContainer);
  });
});
