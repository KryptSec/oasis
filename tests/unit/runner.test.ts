import { describe, it, expect } from 'vitest';
import { buildDockerExecInvocation, stripThinkingTags, extractCommandFromText, findJsonBlocks, extractErrorOutput, trimMessages } from '../../src/lib/runner.js';

// =============================================================================
// buildDockerExecInvocation
// =============================================================================

describe('buildDockerExecInvocation', () => {
  it('uses docker exec with stdin script mode (no bash -c)', () => {
    const invocation = buildDockerExecInvocation('ls -la', 'gatekeeper-kali-1');

    expect(invocation.command).toBe('docker');
    expect(invocation.args).toEqual(['exec', '-i', 'gatekeeper-kali-1', 'bash']);
    expect(invocation.args).not.toContain('-c');
    expect(invocation.input).toBe('ls -la');
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
  it('strips multiline thinking tags (case-insensitive)', () => {
    const input = `<think>\nI should try SQL injection.\n</think>\nHere is my plan.`;
    expect(stripThinkingTags(input)).toBe('Here is my plan.');

    expect(stripThinkingTags('<THINK>loud</THINK>quiet')).toBe('quiet');
    expect(stripThinkingTags('<thinking>deep thought</thinking>result')).toBe('result');
  });

  it('strips multiple thinking blocks', () => {
    const input = '<think>first</think>middle<think>second</think>end';
    expect(stripThinkingTags(input)).toBe('middleend');
  });

  it('strips content after unclosed opening tag', () => {
    expect(stripThinkingTags('<think>unclosed tag without end')).toBe('');
  });

  it('returns text unchanged when no tags present', () => {
    expect(stripThinkingTags('no tags here')).toBe('no tags here');
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

  it('extracts command from Qwen3-style output with thinking tags', () => {
    const input = `<think>\nI need to enumerate the target.\n</think>\n\n{"name":"run_command","arguments":{"command":"nmap -sV target:8080"}}`;
    expect(extractCommandFromText(input)).toBe('nmap -sV target:8080');
  });

  it('handles stringified arguments', () => {
    const input = `{"name":"run_command","arguments":"{\\"command\\":\\"whoami\\"}"}`;
    expect(extractCommandFromText(input)).toBe('whoami');
  });

  it('returns null for no command, malformed JSON, or wrong tool name', () => {
    expect(extractCommandFromText('Just some regular text without any commands.')).toBeNull();
    expect(extractCommandFromText('{"name":"run_command","arguments":{')).toBeNull();
    expect(extractCommandFromText('{"name":"run_command","arguments":{"foo":"bar"}}')).toBeNull();
    expect(extractCommandFromText('{"name":"other_tool","arguments":{"command":"ls"}}')).toBeNull();
  });
});

// =============================================================================
// findJsonBlocks
// =============================================================================

describe('findJsonBlocks', () => {
  it('finds JSON blocks in text', () => {
    expect(findJsonBlocks('text {"key":"value"} more text')).toEqual(['{"key":"value"}']);
    expect(findJsonBlocks('first {"a":1} middle {"b":2} end')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('finds nested JSON blocks', () => {
    expect(findJsonBlocks('{"outer":{"inner":"value"}}')).toEqual(['{"outer":{"inner":"value"}}']);
  });

  it('returns empty array for no JSON', () => {
    expect(findJsonBlocks('no json here')).toEqual([]);
  });
});

// =============================================================================
// extractErrorOutput
// =============================================================================

describe('extractErrorOutput', () => {
  it('extracts stderr from error object (string or Buffer)', () => {
    expect(extractErrorOutput({ stderr: 'permission denied', message: 'fallback' })).toBe('permission denied');
    expect(extractErrorOutput({ stderr: Buffer.from('buffer error'), message: 'fallback' })).toBe('buffer error');
  });

  it('falls back to Error message when no stderr', () => {
    expect(extractErrorOutput(new Error('something broke'))).toBe('something broke');
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

  it('returns messages unchanged when at or under limit', () => {
    const msgs = makeMessages(10);
    expect(trimMessages(msgs)).toEqual(msgs);

    const atLimit = makeMessages(MAX_CONTEXT_MESSAGES);
    expect(trimMessages(atLimit)).toEqual(atLimit);
  });

  it('trims messages over limit preserving anchor and role alternation', () => {
    const msgs = makeMessages(MAX_CONTEXT_MESSAGES + 10);
    const result = trimMessages(msgs);
    expect(result[0]).toBe(msgs[0]);
    expect(result[result.length - 1]).toBe(msgs[msgs.length - 1]);
    expect(result.length).toBeLessThanOrEqual(MAX_CONTEXT_MESSAGES);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].role).not.toBe(result[i - 1].role);
    }
  });

  it('drops adjacent same-role when anchor matches tail[0]', () => {
    const msgs = makeMessages(MAX_CONTEXT_MESSAGES + 1);
    const result = trimMessages(msgs);
    expect(result[0].role).toBe('user');
    expect(result[1].role).not.toBe('user');
    for (let i = 1; i < result.length; i++) {
      expect(result[i].role).not.toBe(result[i - 1].role);
    }
  });

  it('drops multiple consecutive same-role messages at trim boundary', () => {
    const msgs: { role: string; content: string }[] = [
      { role: 'user', content: 'anchor' },
    ];
    for (let i = 1; i <= 5; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `early-${i}` });
    }
    msgs.push({ role: 'user', content: 'tool-1' });
    msgs.push({ role: 'user', content: 'tool-2' });
    msgs.push({ role: 'user', content: 'tool-3' });
    let nextRole: 'assistant' | 'user' = 'assistant';
    while (msgs.length <= MAX_CONTEXT_MESSAGES + 5) {
      msgs.push({ role: nextRole, content: `fill-${msgs.length}` });
      nextRole = nextRole === 'assistant' ? 'user' : 'assistant';
    }

    const result = trimMessages(msgs);
    expect(result[0].role).toBe('user');
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

  it('skips orphaned tool messages at trim boundary', () => {
    const msgs: { role: string; content: string }[] = [
      { role: 'user', content: 'system prompt' },
    ];
    for (let i = 1; i < MAX_CONTEXT_MESSAGES; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
    }
    msgs.push({ role: 'tool', content: 'tool-response-orphaned' });
    msgs.push({ role: 'tool', content: 'tool-response-orphaned-2' });
    msgs.push({ role: 'assistant', content: 'next-reasoning' });
    msgs.push({ role: 'user', content: 'latest' });

    const result = trimMessages(msgs);
    expect(result[1].role).not.toBe('tool');
    expect(result[1].role).toBe('assistant');
  });

  it('handles tool message right after anchor role collision', () => {
    const msgs: { role: string; content: string }[] = [
      { role: 'user', content: 'anchor' },
    ];
    for (let i = 1; i <= MAX_CONTEXT_MESSAGES + 2; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `fill-${i}` });
    }
    const tailStart = msgs.length - MAX_CONTEXT_MESSAGES + 1;
    msgs[tailStart] = { role: 'user', content: 'collision' };
    msgs[tailStart + 1] = { role: 'tool', content: 'orphaned-tool' };
    msgs[tailStart + 2] = { role: 'assistant', content: 'recovery' };

    const result = trimMessages(msgs);
    expect(result[0].role).toBe('user');
    expect(result[1].role).not.toBe('tool');
  });
});
