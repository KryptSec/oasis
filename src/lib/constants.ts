// Named constants — replacing magic numbers across the codebase

// API limits
export const MAX_COMPLETION_TOKENS = 4096;

// Output truncation
export const STEP_OUTPUT_LIMIT = 10_000;      // Stored in step records
export const TOOL_FEEDBACK_LIMIT = 50_000;    // Sent back to model as context
export const ANALYZER_OUTPUT_LIMIT = 500;     // In analysis prompts

// Timeouts (ms)
export const DOCKER_EXEC_TIMEOUT = 60_000;
export const DOCKER_WAIT_TIMEOUT = 30_000;
export const DOCKER_POLL_INTERVAL = 2_000;
export const DOCKER_STARTUP_POLL = 2_500;

// Analyzer LLM call timeout. The analyzer prompt embeds a full attack chain
// (up to 45 steps), which can be far larger than a benchmark step, so it needs
// more headroom than the generic 120s API default. Long-running benchmarks were
// losing KSM scores to "Analysis: timed out after 120s" on complex transcripts.
export const ANALYZER_TIMEOUT_MS = 300_000;   // 5 minutes

// Display
export const VERBOSE_OUTPUT_PREVIEW = 2_000;

// Memory bounds
export const MAX_CONTEXT_MESSAGES = 40;
