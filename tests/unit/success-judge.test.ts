import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveJudge, judgeIsAvailable, judgeSteps } from '../../src/lib/success-judge.js';
import type { Step } from '../../src/lib/types.js';

function step(over: Partial<Step> = {}): Step {
  return {
    iteration: 1,
    timestamp: new Date(),
    duration: 0,
    reasoning: '',
    type: 'tool_call',
    command: 'cat flag.txt',
    output: 'cat: flag.txt: No such file or directory',
    success: true, // what the regex judge decided
    inputTokens: 0,
    outputTokens: 0,
    ...over,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

// =============================================================================
// resolveJudge / judgeIsAvailable
// =============================================================================

describe('resolveJudge', () => {
  it('defaults to regex when unset', () => {
    expect(resolveJudge({})).toBe('regex');
  });

  it('opts in only on the exact value', () => {
    expect(resolveJudge({ OASIS_SUCCESS_JUDGE: 'typesafe' })).toBe('typesafe');
    expect(resolveJudge({ OASIS_SUCCESS_JUDGE: '  TypeSafe ' })).toBe('typesafe');
    expect(resolveJudge({ OASIS_SUCCESS_JUDGE: 'jev' })).toBe('regex');
    expect(resolveJudge({ OASIS_SUCCESS_JUDGE: '' })).toBe('regex');
  });

  it('does not opt in merely because a key is present', () => {
    expect(resolveJudge({ TYPESAFE_API_KEY: 'k' })).toBe('regex');
  });
});

describe('judgeIsAvailable', () => {
  it('regex is always available', () => {
    expect(judgeIsAvailable('regex', {})).toBe(true);
  });

  it('typesafe needs a non-blank key', () => {
    expect(judgeIsAvailable('typesafe', {})).toBe(false);
    expect(judgeIsAvailable('typesafe', { TYPESAFE_API_KEY: '   ' })).toBe(false);
    expect(judgeIsAvailable('typesafe', { TYPESAFE_API_KEY: 'k' })).toBe(true);
  });
});

// =============================================================================
// judgeSteps — disabled paths leave the run untouched
// =============================================================================

describe('judgeSteps when not enabled', () => {
  it('is a no-op under the default judge', async () => {
    const s = step();
    const out = await judgeSteps([s], { env: {} });
    expect(out).toEqual({ judge: 'regex', changed: 0, failed: 0 });
    expect(s.success).toBe(true); // regex verdict preserved
    expect(s.successConfidence).toBeUndefined();
  });

  it('falls back to regex when opted in without a key', async () => {
    const s = step();
    const out = await judgeSteps([s], { env: { OASIS_SUCCESS_JUDGE: 'typesafe' } });
    expect(out.judge).toBe('regex');
    expect(s.success).toBe(true);
  });

  it('reports typesafe with nothing to do when there are no tool calls', async () => {
    const out = await judgeSteps([step({ type: 'text', command: undefined })], {
      env: { OASIS_SUCCESS_JUDGE: 'typesafe', TYPESAFE_API_KEY: 'k' },
    });
    expect(out).toEqual({ judge: 'typesafe', changed: 0, failed: 0 });
  });
});

// =============================================================================
// judgeSteps — enabled, with the SDK mocked
// =============================================================================

const ENV = { OASIS_SUCCESS_JUDGE: 'typesafe', TYPESAFE_API_KEY: 'k' };

function mockSdk(handler: (state: { step: { command: string; output: string } }) => number | Error) {
  vi.doMock('@typesafe-ai/sdk', () => ({
    noul: (instructions: string, criteria: unknown) => ({ type: 'noul', instructions, criteria }),
    TypeSafeClient: class {
      async systemOne(req: { state: { step: { command: string; output: string } } }) {
        const r = handler(req.state);
        if (r instanceof Error) throw r;
        return { answers: { succeeded: { type: 'noul', noul: r } } };
      }
    },
  }));
}

describe('judgeSteps with the typesafe judge', () => {
  it('overturns the three known regex false positives', async () => {
    mockSdk(() => 0.02);
    const { judgeSteps: judge } = await import('../../src/lib/success-judge.js');
    const steps = [
      step({ command: 'cat flag.txt', output: 'cat: flag.txt: No such file or directory' }),
      step({ command: 'curl http://target/admin', output: 'HTTP/1.1 404 Not Found\r\nContent-Length: 1200\r\n' }),
      step({ command: 'grep -r flag /var/www', output: 'grep: /var/www: No such file or directory' }),
    ];
    const out = await judge(steps, { env: ENV });

    expect(out).toEqual({ judge: 'typesafe', changed: 3, failed: 0 });
    expect(steps.every(s => s.success === false)).toBe(true);
    expect(steps.every(s => s.successConfidence === 0.02)).toBe(true);
  });

  it('leaves a correct verdict alone and does not count it as changed', async () => {
    mockSdk(() => 0.97);
    const { judgeSteps: judge } = await import('../../src/lib/success-judge.js');
    const s = step({ command: 'cat /home/user/flag.txt', output: 'KX{r34l_fl4g_h3r3}', success: true });
    const out = await judge([s], { env: ENV });

    expect(out.changed).toBe(0);
    expect(s.success).toBe(true);
    expect(s.successConfidence).toBe(0.97);
  });

  it('thresholds at 0.5', async () => {
    mockSdk(state => (state.step.command === 'high' ? 0.5 : 0.49));
    const { judgeSteps: judge } = await import('../../src/lib/success-judge.js');
    const hi = step({ command: 'high', success: false });
    const lo = step({ command: 'low', success: false });
    await judge([hi, lo], { env: ENV });

    expect(hi.success).toBe(true);
    expect(lo.success).toBe(false);
  });

  it('keeps the regex verdict when a call fails, and counts it', async () => {
    mockSdk(state => (state.step.command === 'boom' ? new Error('503') : 0.02));
    const { judgeSteps: judge } = await import('../../src/lib/success-judge.js');
    const bad = step({ command: 'boom', output: 'x', success: true });
    const good = step({ command: 'cat flag.txt', success: true });
    const out = await judge([bad, good], { env: ENV });

    expect(out).toEqual({ judge: 'typesafe', changed: 1, failed: 1 });
    expect(bad.success).toBe(true); // untouched — regex verdict preserved
    expect(bad.successConfidence).toBeUndefined();
    expect(good.success).toBe(false);
  });

  it('judges every tool_call step and skips text steps', async () => {
    const seen: string[] = [];
    mockSdk(state => {
      seen.push(state.step.command);
      return 0.9;
    });
    const { judgeSteps: judge } = await import('../../src/lib/success-judge.js');
    await judge(
      [
        step({ command: 'a' }),
        step({ type: 'text', command: undefined, output: 'thinking' }),
        step({ command: 'b' }),
      ],
      { env: ENV },
    );

    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('truncates very long output before sending it', async () => {
    let sent = 0;
    mockSdk(state => {
      sent = state.step.output.length;
      return 0.9;
    });
    const { judgeSteps: judge } = await import('../../src/lib/success-judge.js');
    await judge([step({ output: 'x'.repeat(50_000) })], { env: ENV });

    expect(sent).toBe(4000);
  });

  it('keeps all verdicts when the SDK cannot be loaded', async () => {
    vi.doMock('@typesafe-ai/sdk', () => {
      throw new Error('not installed');
    });
    const { judgeSteps: judge } = await import('../../src/lib/success-judge.js');
    const s = step({ success: true });
    const out = await judge([s], { env: ENV });

    expect(out).toEqual({ judge: 'regex', changed: 0, failed: 1 });
    expect(s.success).toBe(true);
  });
});
