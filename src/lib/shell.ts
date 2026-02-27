// Shared shell utility

/** Escape a string for safe inclusion in a shell command (single-quote wrapping). */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
