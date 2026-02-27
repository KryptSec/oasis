import { describe, it, expect } from 'vitest';
import { buildDockerExecInvocation, stripThinkingTags, extractCommandFromText, findJsonBlocks, extractErrorOutput, trimMessages } from '../../src/lib/runner.js';

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

// =============================================================================
// extractErrorOutput
// =============================================================================

describe('extractErrorOutput', () => {
  it('extracts stderr string from error object', () => {
    const err = { stderr: 'permission denied', message: 'fallback' };
    expect(extractErrorOutput(err)).toBe('permission denied');
  });

  it('extracts stderr Buffer from error object', () => {
    const err = { stderr: Buffer.from('buffer error'), message: 'fallback' };
    expect(extractErrorOutput(err)).toBe('buffer error');
  });

  it('falls back to Error message when no stderr', () => {
    expect(extractErrorOutput(new Error('something broke'))).toBe('something broke');
  });

  it('returns default for null', () => {
    expect(extractErrorOutput(null)).toBe('Command failed');
  });

  it('returns default for undefined', () => {
    expect(extractErrorOutput(undefined)).toBe('Command failed');
  });

  it('handles string errors', () => {
    expect(extractErrorOutput('raw string')).toBe('Command failed');
  });

  it('prefers stderr over message', () => {
    const err = new Error('msg');
    (err as any).stderr = 'stderr output';
    expect(extractErrorOutput(err)).toBe('stderr output');
  });
});

// =============================================================================
// trimMessages
// =============================================================================

describe('trimMessages', () => {
  const MAX_CONTEXT_MESSAGES = 40; // mirrors constants.ts

  function makeMessages(count: number, startRole: 'user' | 'assistant' = 'user') {
    const roles = ['user', 'assistant'] as const;
    const offset = startRole === 'user' ? 0 : 1;
    return Array.from({ length: count }, (_, i) => ({
      role: roles[(i + offset) % 2],
      content: `msg-${i}`,
    }));
  }

  it('returns messages unchanged when under limit', () => {
    const msgs = makeMessages(10);
    expect(trimMessages(msgs)).toEqual(msgs);
  });

  it('returns messages unchanged when at limit', () => {
    const msgs = makeMessages(MAX_CONTEXT_MESSAGES);
    expect(trimMessages(msgs)).toEqual(msgs);
  });

  it('trims messages over limit preserving anchor', () => {
    const msgs = makeMessages(MAX_CONTEXT_MESSAGES + 10);
    const result = trimMessages(msgs);
    // First message preserved
    expect(result[0]).toBe(msgs[0]);
    // Last message preserved
    expect(result[result.length - 1]).toBe(msgs[msgs.length - 1]);
    // Length is at most MAX_CONTEXT_MESSAGES
    expect(result.length).toBeLessThanOrEqual(MAX_CONTEXT_MESSAGES);
  });

  it('preserves role alternation after trim', () => {
    const msgs = makeMessages(MAX_CONTEXT_MESSAGES + 10);
    const result = trimMessages(msgs);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].role).not.toBe(result[i - 1].role);
    }
  });

  it('drops adjacent same-role when anchor matches tail[0]', () => {
    // Force anchor and tail[0] to share a role by using an even-offset count
    // anchor is user (index 0), and we need tail[0] to also be user
    // With alternating roles, tail[0] role depends on the slice offset
    // Build a custom array where this collision happens
    const msgs = makeMessages(MAX_CONTEXT_MESSAGES + 1);
    // msgs[0].role = 'user', tail = msgs.slice(-39)
    // msgs.slice(-39)[0] = msgs[MAX_CONTEXT_MESSAGES + 1 - 39] = msgs[2]
    // msgs[2].role = 'user' — collision! tail[0] should be dropped
    const result = trimMessages(msgs);
    expect(result[0].role).toBe('user');
    expect(result[1].role).not.toBe('user');
    // Verify no adjacent same-role
    for (let i = 1; i < result.length; i++) {
      expect(result[i].role).not.toBe(result[i - 1].role);
    }
  });

  it('drops multiple consecutive same-role messages at trim boundary', () => {
    // Build array where the trim boundary lands on multiple same-role messages
    // that collide with the anchor (messages[0]).
    // Anchor = user. We need tail[0], tail[1], ... to also be 'user'.
    const msgs: { role: string; content: string }[] = [
      { role: 'user', content: 'anchor' },
    ];
    // Fill with alternating roles up to the trim point
    for (let i = 1; i <= 5; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `early-${i}` });
    }
    // Now add a block of consecutive 'user' messages (simulating tool results)
    // followed by normal alternation to fill past the limit
    msgs.push({ role: 'user', content: 'tool-1' });
    msgs.push({ role: 'user', content: 'tool-2' });
    msgs.push({ role: 'user', content: 'tool-3' });
    // Fill remaining with alternating to go past limit
    let nextRole: 'assistant' | 'user' = 'assistant';
    while (msgs.length <= MAX_CONTEXT_MESSAGES + 5) {
      msgs.push({ role: nextRole, content: `fill-${msgs.length}` });
      nextRole = nextRole === 'assistant' ? 'user' : 'assistant';
    }

    const result = trimMessages(msgs);
    // Anchor preserved
    expect(result[0].role).toBe('user');
    // result[1] must not be 'user' (anchor collision resolved)
    expect(result[1].role).not.toBe('user');
  });

  it('works with OpenAI-style system role anchor', () => {
    const msgs: { role: string; content: string }[] = [
      { role: 'system', content: 'system prompt' },
      ...makeMessages(MAX_CONTEXT_MESSAGES + 10).slice(1),
    ];
    const result = trimMessages(msgs);
    expect(result[0].role).toBe('system');
    expect(result.length).toBeLessThanOrEqual(MAX_CONTEXT_MESSAGES);
  });
});
