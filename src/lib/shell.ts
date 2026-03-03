// Shared shell utility

/**
 * Escape a string for safe inclusion in a shell command.
 * Uses single-quote wrapping on POSIX (bash/zsh/sh) and
 * double-quote wrapping on Windows (cmd.exe).
 */
export function shellEscape(s: string): string {
  if (process.platform === 'win32') {
    // cmd.exe: wrap in double quotes, escape internal double quotes and percent signs
    return '"' + s.replace(/%/g, '%%').replace(/"/g, '\\"') + '"';
  }
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
