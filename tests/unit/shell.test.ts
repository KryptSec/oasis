import { describe, it, expect } from 'vitest';
import { shellEscape } from '../../src/lib/shell.js';

describe('shellEscape', () => {
  it('escapes single quotes inside strings', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('handles nested single and double quotes', () => {
    expect(shellEscape("it's a \"test\"")).toBe("'it'\\''s a \"test\"'");
  });

  it('handles multiple consecutive single quotes', () => {
    expect(shellEscape("'''")).toBe("''\\'''\\'''\\'''");
  });
});
