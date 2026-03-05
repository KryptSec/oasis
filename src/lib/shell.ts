// Shared shell utility

/**
 * Escape a string for safe inclusion in a POSIX shell command (single-quote wrapping).
 *
 * NOTE: This function is POSIX-only (bash/zsh/sh). It does NOT handle Windows
 * cmd.exe quoting. For cross-platform subprocess calls, use execFileSync/spawnSync
 * with argument arrays instead of shell strings — this bypasses the shell entirely
 * and avoids escaping issues on all platforms.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
