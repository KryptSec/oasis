/**
 * Cost estimation for benchmark runs.
 *
 * OASIS already records token usage per run (`RunResult.tokens`), but nothing
 * translates those tokens into money — so a benchmark sweep's spend is invisible
 * until the provider invoice arrives, and there is no way to compare models on
 * cost-per-flag.
 *
 * This module is deliberately a pure lookup + arithmetic layer: no network
 * calls, no provider SDKs. Prices are declared in a table so they are trivial to
 * audit and update, and unknown models are reported as unpriced rather than
 * silently guessed at zero (which is how a cost model quietly becomes fiction).
 */

import type { RunResult, TokenUsage } from './types.js';

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
  /** Where the number came from, for auditability. */
  source: string;
}

/**
 * Price table, keyed by a lowercase substring matched against the model id.
 *
 * Matching is substring-based so versioned ids ("zai-org/GLM-5.3-Flash",
 * "glm-5.3-flash-2026-01") resolve without an exhaustive enumeration. Order
 * matters: the first matching key wins, so more specific keys must come first.
 *
 * NOTE: These are list prices for estimation and benchmark comparison, not a
 * billing source of truth. Update as providers change pricing.
 */
export const MODEL_PRICES: ReadonlyArray<readonly [string, ModelPrice]> = [
  // Anthropic
  ['claude-opus', { input: 15, output: 75, source: 'anthropic-list' }],
  ['claude-sonnet', { input: 3, output: 15, source: 'anthropic-list' }],
  ['claude-haiku', { input: 0.8, output: 4, source: 'anthropic-list' }],

  // OpenAI
  ['gpt-5', { input: 1.25, output: 10, source: 'openai-list' }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6, source: 'openai-list' }],
  ['gpt-4o', { input: 2.5, output: 10, source: 'openai-list' }],

  // DeepInfra-served open models (used for the OASIS attacker roster)
  ['glm-5.3-flash', { input: 0.06, output: 0.12, source: 'deepinfra-list' }],
  ['glm-5.3', { input: 0.2, output: 0.6, source: 'deepinfra-list' }],
  ['kimi-k3', { input: 0.3, output: 1.2, source: 'deepinfra-list' }],
  ['minimax-m3', { input: 0.2, output: 1.0, source: 'deepinfra-list' }],
  ['qwen3.8-27b', { input: 0.1, output: 0.3, source: 'deepinfra-list' }],
  ['qwen3.8', { input: 0.25, output: 0.75, source: 'deepinfra-list' }],
  ['deepseek-v4.1-flash', { input: 0.1, output: 0.3, source: 'deepinfra-list' }],
  ['deepseek', { input: 0.27, output: 1.1, source: 'deepinfra-list' }],
  ['inkling', { input: 0.1, output: 0.4, source: 'deepinfra-list' }],
  ['llama-3.1-8b', { input: 0.03, output: 0.05, source: 'deepinfra-list' }],
  ['mistral-7b', { input: 0.03, output: 0.05, source: 'deepinfra-list' }],
];

/** A run's estimated cost, or an explicit "unpriced" marker. */
export interface CostEstimate {
  model: string;
  /** null when the model has no known price — never silently 0. */
  usd: number | null;
  /** True when tokens were present but no price could be resolved. */
  unpriced: boolean;
  inputTokens: number;
  outputTokens: number;
  price?: ModelPrice;
}

/** Look up the price for a model id, or null if unknown. */
export function resolvePrice(model: string): ModelPrice | null {
  if (!model) return null;
  const id = model.toLowerCase();
  for (const [key, price] of MODEL_PRICES) {
    if (id.includes(key)) return price;
  }
  return null;
}

/** Estimate the USD cost of a token count for a model. */
export function estimateCost(model: string, tokens: TokenUsage): CostEstimate {
  const price = resolvePrice(model);
  const inputTokens = tokens.input ?? 0;
  const outputTokens = tokens.output ?? 0;

  if (!price) {
    return {
      model,
      usd: null,
      unpriced: inputTokens + outputTokens > 0,
      inputTokens,
      outputTokens,
    };
  }

  const usd =
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output;

  return {
    model,
    usd,
    unpriced: false,
    inputTokens,
    outputTokens,
    price,
  };
}

/**
 * Estimate the cost of a single run.
 *
 * Prefers `modelVersion` (the concrete provider model id, e.g.
 * "zai-org/GLM-5.3-Flash") and falls back to `model` (a coarse provenance tag
 * that is often just "custom"). Pricing off `model` alone would mark nearly
 * every run unpriced.
 */
export function estimateRunCost(run: RunResult): CostEstimate {
  const concrete = run.modelVersion || '';
  const coarse = run.model || '';

  // Pick whichever identifier we can actually price; prefer the concrete one.
  if (resolvePrice(concrete)) {
    return estimateCost(concrete, run.tokens);
  }
  if (resolvePrice(coarse)) {
    return estimateCost(coarse, run.tokens);
  }
  return estimateCost(concrete || coarse, run.tokens);
}

/** Aggregate cost across runs, with per-model and cost-per-flag breakdowns. */
export interface CostSummary {
  totalUsd: number;
  /** Runs whose model had no known price. */
  unpricedRuns: number;
  runCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Total flags captured across the runs. */
  flags: number;
  /** USD per captured flag; null when no flags were captured. */
  usdPerFlag: number | null;
  byModel: Array<{
    model: string;
    runs: number;
    usd: number;
    unpriced: boolean;
    inputTokens: number;
    outputTokens: number;
    flags: number;
    usdPerFlag: number | null;
  }>;
}

/** Format a USD amount for terminal display. */
export function formatUsd(amount: number): string {
  if (amount < 0.01 && amount > 0) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

/**
 * Summarise the cost of a set of runs.
 * Unpriced runs are counted and reported separately rather than assumed free.
 */
export function summarizeCosts(runs: RunResult[]): CostSummary {
  const perModel = new Map<string, CostSummary['byModel'][number]>();

  let totalUsd = 0;
  let unpricedRuns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let flags = 0;

  for (const run of runs) {
    const est = estimateRunCost(run);
    const captured = run.flag != null && run.flag !== '';
    if (captured) flags += 1;

    totalInputTokens += est.inputTokens;
    totalOutputTokens += est.outputTokens;

    if (est.usd == null) {
      if (est.unpriced) unpricedRuns += 1;
    } else {
      totalUsd += est.usd;
    }

    // Group by the identifier the cost was computed from, so the breakdown does
    // not collapse every run into the coarse "custom" provenance tag.
    const key = est.model;
    let bucket = perModel.get(key);
    if (!bucket) {
      bucket = {
        model: key,
        runs: 0,
        usd: 0,
        unpriced: est.unpriced,
        inputTokens: 0,
        outputTokens: 0,
        flags: 0,
        usdPerFlag: null,
      };
      perModel.set(key, bucket);
    }
    bucket.runs += 1;
    bucket.inputTokens += est.inputTokens;
    bucket.outputTokens += est.outputTokens;
    if (captured) bucket.flags += 1;
    if (est.usd != null) {
      bucket.usd += est.usd;
    } else if (est.unpriced) {
      bucket.unpriced = true;
    }
  }

  const byModel = Array.from(perModel.values())
    .map(b => ({ ...b, usdPerFlag: b.flags > 0 ? b.usd / b.flags : null }))
    .sort((a, b) => b.usd - a.usd);

  return {
    totalUsd,
    unpricedRuns,
    runCount: runs.length,
    totalInputTokens,
    totalOutputTokens,
    flags,
    usdPerFlag: flags > 0 ? totalUsd / flags : null,
    byModel,
  };
}
