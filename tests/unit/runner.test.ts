import { describe, it, expect } from 'vitest';
import { buildDockerExecInvocation, stripThinkingTags, extractCommandFromText, findJsonBlocks } from '../../src/lib/runner.js';

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

// =============================================================================
// stripThinkingTags
// =============================================================================

describe('stripThinkingTags', () => {
  it('strips single-line <think> tags', () => {
    expect(stripThinkingTags('<think>reasoning here</think>actual content'))
      .toBe('actual content');
  });

  it('strips multiline <think> tags', () => {
    const input = `<think>
I should try SQL injection.
Let me think about the best approach.
</think>
Here is my plan.`;
    expect(stripThinkingTags(input)).toBe('Here is my plan.');
  });

  it('strips <thinking> tags', () => {
    expect(stripThinkingTags('<thinking>deep thought</thinking>result'))
      .toBe('result');
  });

  it('strips multiple thinking blocks', () => {
    const input = '<think>first</think>middle<think>second</think>end';
    expect(stripThinkingTags(input)).toBe('middleend');
  });

  it('is case-insensitive', () => {
    expect(stripThinkingTags('<THINK>loud thinking</THINK>quiet output'))
      .toBe('quiet output');
    expect(stripThinkingTags('<Think>mixed case</Think>output'))
      .toBe('output');
  });

  it('returns text unchanged when no tags present', () => {
    expect(stripThinkingTags('no tags here')).toBe('no tags here');
  });

  it('returns empty string for empty input', () => {
    expect(stripThinkingTags('')).toBe('');
  });

  it('strips content after unclosed opening tag', () => {
    expect(stripThinkingTags('<think>unclosed tag without end')).toBe('');
  });

  it('handles nested thinking tags', () => {
    const input = '<think>outer<think>inner</think>still thinking</think>command';
    expect(stripThinkingTags(input)).toBe('command');
  });
});

// =============================================================================
// extractCommandFromText
// =============================================================================

describe('extractCommandFromText', () => {
  it('extracts command from <tool_call> tags', () => {
    const input = `<tool_call>{"name":"run_command","arguments":{"command":"ls -la"}}</tool_call>`;
    expect(extractCommandFromText(input)).toBe('ls -la');
  });

  it('extracts command from raw JSON in text', () => {
    const input = `I will run a command now.
{"name":"run_command","arguments":{"command":"curl http://target"}}`;
    expect(extractCommandFromText(input)).toBe('curl http://target');
  });

  it('extracts command from Qwen3-style output with thinking tags', () => {
    const input = `<think>
I need to enumerate the target.
Let me use nmap to scan for open ports.
</think>

{"name":"run_command","arguments":{"command":"nmap -sV target:8080"}}`;
    expect(extractCommandFromText(input)).toBe('nmap -sV target:8080');
  });

  it('handles stringified arguments', () => {
    const input = `{"name":"run_command","arguments":"{\\"command\\":\\"whoami\\"}"}`;
    expect(extractCommandFromText(input)).toBe('whoami');
  });

  it('handles parameters field instead of arguments', () => {
    const input = `{"name":"run_command","parameters":{"command":"id"}}`;
    expect(extractCommandFromText(input)).toBe('id');
  });

  it('returns null when no command found', () => {
    expect(extractCommandFromText('Just some regular text without any commands.')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractCommandFromText('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractCommandFromText('{"name":"run_command","arguments":{')).toBeNull();
  });

  it('returns null for JSON without command field', () => {
    expect(extractCommandFromText('{"name":"run_command","arguments":{"foo":"bar"}}')).toBeNull();
  });

  it('returns null for JSON with wrong tool name', () => {
    expect(extractCommandFromText('{"name":"other_tool","arguments":{"command":"ls"}}')).toBeNull();
  });

  it('extracts command when mixed with other text and thinking', () => {
    const input = `<think>Let me try something</think>
I'll check the web server.
<tool_call>
{"name": "run_command", "arguments": {"command": "curl -s http://target/"}}
</tool_call>`;
    expect(extractCommandFromText(input)).toBe('curl -s http://target/');
  });
});

// =============================================================================
// findJsonBlocks
// =============================================================================

describe('findJsonBlocks', () => {
  it('finds a single JSON block', () => {
    const input = 'text {"key":"value"} more text';
    expect(findJsonBlocks(input)).toEqual(['{"key":"value"}']);
  });

  it('finds nested JSON blocks', () => {
    const input = '{"outer":{"inner":"value"}}';
    expect(findJsonBlocks(input)).toEqual(['{"outer":{"inner":"value"}}']);
  });

  it('finds multiple JSON blocks', () => {
    const input = 'first {"a":1} middle {"b":2} end';
    expect(findJsonBlocks(input)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('returns empty array for no braces', () => {
    expect(findJsonBlocks('no json here')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(findJsonBlocks('')).toEqual([]);
  });

  it('handles unbalanced braces by skipping incomplete blocks', () => {
    const input = '{"complete":true} {"incomplete":';
    expect(findJsonBlocks(input)).toEqual(['{"complete":true}']);
  });
});
