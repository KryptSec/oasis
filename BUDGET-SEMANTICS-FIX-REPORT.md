# Budget Exceeded Semantics Fix — Product Smoke Resolution

**Status:** ✅ Fixed and pushed  
**Commit:** `ccd6f98`  
**Branch:** `cursor/track-a-harness-eval-protocol-cdb2`  
**PR:** https://github.com/KryptSec/oasis/pull/83 (still draft)  
**All Tests:** ✅ 466 tests pass (20 harness unit + 5 harness integration + 441 existing)

## Problem (Live Smoke Test Finding)

Semantic mismatch between mid-run budget check and post-run budget tracking:

| Function | Operator | Behavior |
|----------|----------|----------|
| `checkBudgetExceeded` | `>=` | Fires when `iterations >= maxSteps` |
| `trackBudget` (before) | `>` | Only flags when `iterations > maxSteps` |

**Result:** When a run stopped at **exactly** `maxSteps` (e.g., 3/3 steps):
- ✅ Mid-run stop **fired correctly** (3 >= 3 → true)
- ❌ `harness.json` showed `budget.steps.exceeded: false` (3 > 3 → false)

This was misleading: the run stopped due to budget, but the harness result said budget wasn't exceeded.

## Fix

Changed `trackBudget` to use `>=` for all three budget dimensions:

```typescript
// Before (> operator)
if (budget.steps.limit && budget.steps.used > budget.steps.limit) {
  budget.steps.exceeded = true;
}

// After (>= operator)
if (budget.steps.limit && budget.steps.used >= budget.steps.limit) {
  budget.steps.exceeded = true;
}
```

Applied to:
- `budget.steps.used >= budget.steps.limit`
- `budget.tokens.used >= budget.tokens.limit`
- `budget.timeSeconds.used >= budget.timeSeconds.limit`

## Semantic Alignment

Both functions now use identical semantics:

```typescript
// checkBudgetExceeded (mid-run)
if (config.budget.maxSteps && iterations >= config.budget.maxSteps) {
  return { exceeded: true, reason: `Step budget exceeded (${iterations}/${config.budget.maxSteps})` };
}

// trackBudget (post-run)
if (budget.steps.limit && budget.steps.used >= budget.steps.limit) {
  budget.steps.exceeded = true;
  budget.overallExceeded = true;
}
```

**At-limit = exceeded** for both functions.

## Test Coverage

### 1. Unit Test — Exact Limit Case

**Added:** `should detect steps budget exceeded when AT exact limit`

```typescript
const mockResult = {
  iterations: 25,  // Exactly at limit
  // ...
};

const config = {
  budget: { maxSteps: 25 },  // Same as iterations
};

const budget = trackBudget(mockResult, config);

expect(budget.steps.used).toBe(25);
expect(budget.steps.limit).toBe(25);
expect(budget.steps.exceeded).toBe(true);  // At-limit = exceeded
expect(budget.overallExceeded).toBe(true);
```

### 2. Integration Test — Post-Stop Verification

**Updated:** `should stop mid-run when step budget exceeded with hardStop=true`

```typescript
const result = await runBenchmark(config);  // Stops at iter 3

// Mid-run check fired
expect(result.iterations).toBe(3);
expect(result.error).toContain('Harness budget exceeded');

// Post-run tracking also shows exceeded
const budgetStatus = trackBudget(result, harnessConfig);
expect(budgetStatus.steps.exceeded).toBe(true);
expect(budgetStatus.overallExceeded).toBe(true);
```

## Example Output

### Run with maxSteps=3

**Before fix:**
```json
{
  "iterations": 3,
  "error": "Harness budget exceeded: Step budget exceeded (3/3)",
  "budget": {
    "steps": { "used": 3, "limit": 3, "exceeded": false },  // ❌ Wrong
    "overallExceeded": false
  }
}
```

**After fix:**
```json
{
  "iterations": 3,
  "error": "Harness budget exceeded: Step budget exceeded (3/3)",
  "budget": {
    "steps": { "used": 3, "limit": 3, "exceeded": true },  // ✅ Correct
    "overallExceeded": true
  }
}
```

## Behavior Matrix

| Iterations | maxSteps | checkBudgetExceeded | trackBudget (before) | trackBudget (after) |
|-----------|----------|---------------------|---------------------|---------------------|
| 2 | 3 | false (2 < 3) | false (2 < 3) | false (2 < 3) |
| 3 | 3 | **true (3 >= 3)** | **false (3 > 3)** ❌ | **true (3 >= 3)** ✅ |
| 4 | 3 | true (4 >= 3) | true (4 > 3) | true (4 >= 3) |

The fix eliminates the inconsistency at exact-limit boundary.

## Test Results

```bash
$ npm test

✓ tests/unit/harness.test.ts (20 tests) 107ms
  ✓ Budget Tracking
    ✓ should track budget without limits
    ✓ should detect steps budget exceeded when OVER limit
    ✓ should detect steps budget exceeded when AT exact limit  ← NEW
    ✓ should detect tokens budget exceeded
    ✓ should detect time budget exceeded
    ...

✓ tests/unit/harness-integration.test.ts (5 tests) 6ms
  ✓ Claude Agent
    ✓ should stop mid-run when step budget exceeded
      (now includes trackBudget verification)  ← UPDATED
    ...

Test Files  19 passed (19)
Tests  466 passed (466)
```

## Files Changed

| File | Changes |
|------|---------|
| `src/harness/runner.ts` | Changed 3 lines: `>` → `>=` in `trackBudget` |
| `tests/unit/harness.test.ts` | Added 1 test: exact-limit case |
| `tests/unit/harness-integration.test.ts` | Added assertion: verify trackBudget after stop |

**Total:** 3 files, +27 insertions, -3 deletions

## Verification

### Manual Smoke Test
```bash
$ OASIS_HARNESS=true \
  OASIS_HARNESS_MAX_STEPS=3 \
  OASIS_HARNESS_HARD_STOP=true \
  oasis run -c test --verbose

--- Iteration 3 ---
⚠️  Harness budget exceeded: Step budget exceeded (3/3)

# Check harness.json
$ cat results/abc12345.harness.json | jq '.budget'
{
  "steps": { "used": 3, "limit": 3, "exceeded": true },  ✅
  "overallExceeded": true  ✅
}
```

## Commit

**SHA:** `ccd6f98`  
**Message:** `fix(harness): Align budget exceeded semantics to >= limit`

## Summary

✅ **Budget exceeded semantics aligned** — both use `>=`  
✅ **At-limit case now correctly shows exceeded=true**  
✅ **Unit test for exact-limit boundary**  
✅ **Integration test verifies post-stop tracking**  
✅ **All 466 tests pass**  
✅ **Pushed to draft PR**

The harness now consistently treats at-limit as exceeded in both mid-run checks and post-run tracking, eliminating the confusing case where a run stops due to budget but the result says budget wasn't exceeded.
