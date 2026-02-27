// OASIS Error Hierarchy
// Structured error types for categorized error handling

export class OasisError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = 'OasisError';
  }
}

export class ConfigError extends OasisError {
  override name = 'ConfigError';
}

export class AnalysisError extends OasisError {
  override name = 'AnalysisError';
}

export class DockerError extends OasisError {
  override name = 'DockerError';
}

export class ValidationError extends OasisError {
  override name = 'ValidationError';
}
