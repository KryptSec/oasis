# Integration Tests for Mid-Run Budget Hard Stop

**Status:** ✅ Complete and pushed  
**Commit:** `0c1200e`  
**Branch:** `cursor/track-a-harness-eval-protocol-cdb2`  
**PR:** https://github.com/KryptSec/oasis/pull/83 (still draft)  
**All Tests:** ✅ 465 tests pass (5 new integration tests + 460 existing)

## Problem Identified (Research Honesty Check)

The initial 3 mid-run budget tests (in `harness.test.ts`) only exercised `checkBudgetExceeded()` in a **simulated while-loop**:

```typescript
while (iterations < 10 && !shouldStop) {
  iterations++;
  const check = checkBudgetExceeded(iterations, 0, 0, config);
  if (check.exceeded) shouldStop = true;
}
```

**Issue:** These tests did NOT invoke the real `runClaudeAgent` or `runOpenAIAgent` functions. They didn't prove that the production benchmark loops actually call `checkBudgetExceeded` and respect its result.

## Solution: Proper Integration Tests

Added `tests/unit/harness-integration.test.ts` with 5 integration tests that:
1. Mock the Anthropic and OpenAI SDK clients
2. Invoke the **real** `runBenchmark()` → `runClaudeAgent()` / `runOpenAIAgent()` functions
3. Assert mid-run stop behavior with actual agent loops

### File: `tests/unit/harness-integration.test.ts`
**Lines:** 310  
**Tests:** 5

## Test Breakdown

### 1. Claude Agent — Step Budget Exceeded ✅

**Test:** `should stop mid-run when step budget exceeded with hardStop=true`

```typescript
mockAnthropicCreate.mockResolvedValue({
  // ... returns stop_reason: 'max_tokens' to keep loop going
});

harnessConfig = { maxSteps: 3, hardStop: true };
const result = await runBenchmark(config);

expect(result.iterations).toBe(3);
expect(result.error).toContain('Harness budget exceeded: Step budget exceeded');
expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);  // 2 calls before stop
```

**Proves:**
- Real `runClaudeAgent` loop checks budget mid-run
- Stops at iteration 3 (check fires after `iterations++`, before API call)
- Makes 2 API calls (iter 1 → call 1, iter 2 → call 2, iter 3 → stop before call 3)
- Sets `result.error` with "Harness budget exceeded" message

### 2. Claude Agent — Token Budget Exceeded ✅

**Test:** `should stop mid-run when token budget exceeded`

```typescript
mockAnthropicCreate.mockResolvedValue({
  usage: { input_tokens: 5000, output_tokens: 5000 },  // 10k per call
});

harnessConfig = { maxTokens: 15000, hardStop: true };
const result = await runBenchmark(config);

expect(result.iterations).toBe(3);
expect(result.tokens.total).toBe(20000);  // 2 calls × 10k
expect(result.error).toContain('Token budget exceeded');
```

**Proves:**
- Token budget dimension triggers correctly
- Check uses cumulative `totalTokens.total` from all prior API calls
- Stops at iter 3 after accumulating 20k tokens (exceeds 15k limit)

### 3. Claude Agent — Soft Limit (hardStop=false) ✅

**Test:** `should NOT stop when hardStop=false even if budget exceeded`

```typescript
harnessConfig = { maxSteps: 2, hardStop: false };  // Soft limit
config.maxIterations = 5;

const result = await runBenchmark(config);

expect(result.iterations).toBe(5);
expect(result.error).toBeNull();
expect(mockAnthropicCreate).toHaveBeenCalledTimes(5);
```

**Proves:**
- Soft limits (hardStop=false) don't trigger mid-run stop
- Agent runs to natural completion or maxIterations
- Budget tracked post-hoc but doesn't break loop

### 4. OpenAI Agent — Step Budget Exceeded ✅

**Test:** `should stop mid-run when step budget exceeded with hardStop=true` (OpenAI)

```typescript
mockOpenAICreate.mockResolvedValue({
  choices: [{
    finish_reason: 'length',  // Keep loop going
  }],
});

harnessConfig = { maxSteps: 3, hardStop: true };
const result = await runBenchmark(config);

expect(result.iterations).toBe(3);
expect(result.error).toContain('Harness budget exceeded');
expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
```

**Proves:**
- `runOpenAIAgent` also implements mid-run budget check
- Same behavior as Claude agent (stop at iter 3, 2 API calls)
- Both agent paths covered

### 5. OpenAI Agent — Harness Disabled ✅

**Test:** `should NOT stop when harness disabled even if budget would be exceeded`

```typescript
harnessConfig = { enabled: false, maxSteps: 2, hardStop: true };
config.maxIterations = 5;

const result = await runBenchmark(config);

expect(result.iterations).toBe(5);
expect(result.error).toBeNull();
expect(mockOpenAICreate).toHaveBeenCalledTimes(5);
```

**Proves:**
- `harness.enabled = false` bypasses budget check entirely
- Preserves existing behavior when harness disabled
- Budget only enforced when explicitly opt-in

## How Mocks Work

### API Client Mocks

```typescript
// Mock Anthropic SDK
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
  },
}));

// Mock OpenAI SDK
const mockOpenAICreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockOpenAICreate } };
  },
}));
```

**Key:** Mocks return `stop_reason: 'max_tokens'` (Claude) or `finish_reason: 'length'` (OpenAI) instead of `'end_turn'` / `'stop'`. This keeps the agent loop iterating until budget check fires.

### Docker Exec Mock

```typescript
const mockExecFileSync = vi.fn().mockReturnValue('');
vi.mock('child_process', () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
  execSync: vi.fn(),
}));
```

**Key:** No actual Docker containers needed. Commands execute instantly, returning empty output.

### Budget Check Timing

```typescript
// Inside runClaudeAgent and runOpenAIAgent:
while (iterations < maxIterations && !foundFlag) {
  iterations++;  // ← iter becomes 1, 2, 3...
  
  // Budget check fires HERE (after increment, before API call)
  if (config.harnessConfig?.enabled && config.harnessConfig.budget.hardStop) {
    const budgetCheck = checkBudgetExceeded(iterations, totalTokens.total, elapsed, ...);
    if (budgetCheck.exceeded) {
      agentError = `Harness budget exceeded: ${budgetCheck.reason}`;
      break;  // ← Stops loop before API call
    }
  }
  
  // API call happens here (if budget check didn't fire)
  const response = await client.messages.create(...);
}
```

**Result:** When `maxSteps=3`:
- Iteration 1: check (1 < 3 ✓) → API call 1
- Iteration 2: check (2 < 3 ✓) → API call 2
- Iteration 3: check (3 >= 3 ✗) → **STOP** (no API call 3)

Final counts: `iterations=3`, `API calls=2`

## What This Proves

### Before Integration Tests
- ✅ `checkBudgetExceeded()` logic works in isolation
- ❌ NO proof that production agent loops call it
- ❌ NO proof that `agentError` gets set correctly
- ❌ NO verification of iteration/API-call counts

### After Integration Tests
- ✅ **Real `runClaudeAgent` calls `checkBudgetExceeded` mid-run**
- ✅ **Real `runOpenAIAgent` calls `checkBudgetExceeded` mid-run**
- ✅ **Budget exceeded sets `agentError` with correct message**
- ✅ **Loop breaks cleanly at exact budget limit**
- ✅ **Iteration counts match expected behavior (3 iters, 2 API calls)**
- ✅ **Token budget and step budget both trigger correctly**
- ✅ **hardStop=false and enabled=false bypass checks properly**

## Test Results

```bash
$ npm test

✓ tests/unit/harness-integration.test.ts (5 tests) 6ms
  ✓ Claude Agent (Anthropic)
    ✓ should stop mid-run when step budget exceeded with hardStop=true
    ✓ should stop mid-run when token budget exceeded
    ✓ should NOT stop when hardStop=false even if budget exceeded
  ✓ OpenAI-Compatible Agent
    ✓ should stop mid-run when step budget exceeded with hardStop=true
    ✓ should NOT stop when harness disabled even if budget would be exceeded

Test Files  19 passed (19)
Tests  465 passed (465)
```

## Test Structure

```
tests/unit/
├── harness.test.ts              # 19 tests (unit tests for harness helpers)
│   ├── Config loading (2 tests)
│   ├── Budget tracking (6 tests)
│   ├── Findings generation (2 tests)
│   ├── Coverage ledger (1 test)
│   ├── Validators (4 tests)
│   └── Mid-Run Budget Enforcement (3 tests) ← Helper-level tests
│       ├── should stop benchmark mid-run when hard stop budget exceeded
│       ├── should continue when hard stop disabled
│       └── should check all three budget dimensions
│
└── harness-integration.test.ts  # 5 tests (integration tests) ← NEW
    ├── Claude Agent (Anthropic) (3 tests)
    │   ├── Step budget exceeded
    │   ├── Token budget exceeded
    │   └── hardStop=false
    └── OpenAI Agent (2 tests)
        ├── Step budget exceeded
        └── Harness disabled
```

**Total harness coverage:** 24 tests (19 unit + 5 integration)

## Commits

| Commit | Description |
|--------|-------------|
| `d54c964` | feat(harness): Track A eval harness with findings, budget, coverage |
| `dc1633f` | docs: Add Track A implementation report |
| `ee6b6f6` | fix(harness): Wire mid-run budget hard stop into live benchmark loop |
| `5830499` | docs: Add mid-run budget fix verification report |
| `0c1200e` | **test(harness): Add integration tests for mid-run budget enforcement** ← THIS |

## Summary

✅ **Research honesty check passed**  
✅ **Integration tests prove real agent loops stop mid-run**  
✅ **Mocked API clients enable fast, deterministic testing**  
✅ **All 465 tests pass**  
✅ **Pushed to draft PR branch**

The integration tests definitively prove that:
1. `runClaudeAgent` checks budget after every iteration
2. `runOpenAIAgent` checks budget after every iteration
3. Budget exceeded triggers clean loop break with `agentError` set
4. Partial runs still complete with proper iteration/token counts
5. Soft limits and disabled harness properly bypass checks

Ready for undraft review.
