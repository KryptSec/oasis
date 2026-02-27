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

// Display
export const VERBOSE_OUTPUT_PREVIEW = 2_000;

// Memory bounds
export const MAX_CONTEXT_MESSAGES = 40;
