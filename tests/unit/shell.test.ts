import { describe, it, expect } from 'vitest';
import { shellEscape } from '../../src/lib/shell.js';

describe('shellEscape', () => {
  it('wraps plain strings in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes single quotes', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('handles double quotes', () => {
    expect(shellEscape('say "hello"')).toBe("'say \"hello\"'");
  });

  it('handles backticks', () => {
    expect(shellEscape('echo `whoami`')).toBe("'echo `whoami`'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('handles newlines', () => {
    expect(shellEscape('line1\nline2')).toBe("'line1\nline2'");
  });

  it('handles null bytes', () => {
    expect(shellEscape('test\0null')).toBe("'test\0null'");
  });

  it('handles unicode', () => {
    expect(shellEscape('hello \u{1F600}')).toBe("'hello \u{1F600}'");
  });

  it('handles nested quotes', () => {
    expect(shellEscape("it's a \"test\"")).toBe("'it'\\''s a \"test\"'");
  });

  it('neutralizes semicolon injection', () => {
    const result = shellEscape('; rm -rf /');
    expect(result).toBe("'; rm -rf /'");
  });

  it('neutralizes command substitution', () => {
    const result = shellEscape('$(whoami)');
    expect(result).toBe("'$(whoami)'");
  });

  it('neutralizes backtick execution', () => {
    const result = shellEscape('`id`');
    expect(result).toBe("'`id`'");
  });

  it('handles multiple consecutive single quotes', () => {
    expect(shellEscape("'''")).toBe("''\\'''\\'''\\'''");
  });
});
