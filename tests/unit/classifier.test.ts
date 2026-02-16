import { describe, it, expect } from 'vitest';
import {
  classifyToAttack,
  getTechnique,
  getUniqueTechniques,
  calculateTacticBreakdown,
  classifyCommand,
  extractTool,
  wasSuccessful,
  ATTACK_TECHNIQUES,
} from '../../src/lib/classifier.js';

// =============================================================================
// classifyToAttack
// =============================================================================

describe('classifyToAttack', () => {
  it('classifies SQL injection payloads as T1190', () => {
    expect(classifyToAttack("curl -d \"username=admin' OR '1'='1\"")?.id).toBe('T1190');
  });

  it('classifies UNION SELECT as T1190', () => {
    expect(classifyToAttack("curl -d \"id=1 UNION SELECT * FROM users\"")?.id).toBe('T1190');
  });

  it('classifies path traversal as T1190', () => {
    expect(classifyToAttack('curl http://target/../../etc/passwd')?.id).toBe('T1190');
  });

  it('classifies XSS payloads as T1190', () => {
    expect(classifyToAttack('curl -d "name=<script>alert(1)</script>"')?.id).toBe('T1190');
  });

  it('classifies nmap as T1595.002', () => {
    expect(classifyToAttack('nmap -sV target')?.id).toBe('T1595.002');
  });

  it('classifies sqlmap as T1595.002', () => {
    expect(classifyToAttack('sqlmap -u http://target/page?id=1')?.id).toBe('T1595.002');
  });

  it('classifies gobuster as T1595.003', () => {
    expect(classifyToAttack('gobuster dir -u http://target -w wordlist.txt')?.id).toBe('T1595.003');
  });

  it('classifies ffuf as T1595.003', () => {
    expect(classifyToAttack('ffuf -u http://target/FUZZ -w wordlist.txt')?.id).toBe('T1595.003');
  });

  it('classifies curl as T1592 (reconnaissance)', () => {
    expect(classifyToAttack('curl http://target:5000')?.id).toBe('T1592');
  });

  it('classifies wget as T1592', () => {
    expect(classifyToAttack('wget http://target/page')?.id).toBe('T1592');
  });

  it('classifies default credential attempts as T1078.001', () => {
    expect(classifyToAttack('curl -d "username=admin&password=admin"')?.id).toBe('T1078.001');
  });

  it('classifies hydra as T1110.001', () => {
    expect(classifyToAttack('hydra -l admin -P passwords.txt target http-post')?.id).toBe('T1110.001');
  });

  it('classifies privilege escalation patterns as T1068', () => {
    expect(classifyToAttack('curl -d "role=admin"')?.id).toBe('T1068');
  });

  it('classifies flag/secret access as T1005', () => {
    expect(classifyToAttack('cat /root/flag.txt')?.id).toBe('T1005');
  });

  it('classifies API access as T1213', () => {
    expect(classifyToAttack('curl http://target/api/users')?.id).toBe('T1213');
  });

  it('classifies robots.txt access as T1083', () => {
    expect(classifyToAttack('curl http://target/robots.txt')?.id).toBe('T1083');
  });

  it('classifies system info commands as T1082', () => {
    expect(classifyToAttack('whoami')?.id).toBe('T1082');
  });

  it('classifies agent environment inspection as AGENT-ENV', () => {
    expect(classifyToAttack('which nmap')?.id).toBe('AGENT-ENV');
  });

  it('classifies ls /usr/share/wordlists as AGENT-ENV', () => {
    expect(classifyToAttack('ls /usr/share/wordlists')?.id).toBe('AGENT-ENV');
  });

  it('classifies cookie-based auth as T1078', () => {
    expect(classifyToAttack('curl -H "Cookie: session=abc123" http://target')?.id).toBe('T1078');
  });

  it('classifies steganography tools as T1001.002', () => {
    expect(classifyToAttack('steghide extract -sf image.jpg')?.id).toBe('T1001.002');
  });

  it('classifies packet capture as T1040', () => {
    expect(classifyToAttack('tcpdump -i eth0')?.id).toBe('T1040');
  });

  it('classifies reverse engineering as T1588.005', () => {
    expect(classifyToAttack('binwalk firmware.bin')?.id).toBe('T1588.005');
  });

  it('returns null for unrecognized commands', () => {
    expect(classifyToAttack('echo hello world')).toBeNull();
  });

  it('respects priority ordering (exploit > recon)', () => {
    // SQL injection in a curl command should be T1190 (exploit), not T1592 (curl recon)
    const result = classifyToAttack("curl -d \"username=' OR '1'='1\"");
    expect(result?.id).toBe('T1190');
  });
});

// =============================================================================
// getTechnique
// =============================================================================

describe('getTechnique', () => {
  it('returns technique by ID', () => {
    const tech = getTechnique('T1190');
    expect(tech).not.toBeNull();
    expect(tech?.name).toBe('Exploit Public-Facing Application');
    expect(tech?.tactic).toBe('Initial Access');
  });

  it('returns null for unknown ID', () => {
    expect(getTechnique('T9999')).toBeNull();
  });

  it('returns AGENT-ENV technique', () => {
    const tech = getTechnique('AGENT-ENV');
    expect(tech?.name).toBe('Agent Environment Inspection');
  });
});

// =============================================================================
// getUniqueTechniques
// =============================================================================

describe('getUniqueTechniques', () => {
  it('returns unique techniques from commands', () => {
    const commands = [
      'curl http://target',
      'curl http://target/page',  // same technique as above
      'nmap -sV target',
    ];
    const techniques = getUniqueTechniques(commands);
    expect(techniques).toHaveLength(2);
    expect(techniques.map(t => t.id)).toContain('T1592');
    expect(techniques.map(t => t.id)).toContain('T1595.002');
  });

  it('returns empty array for unrecognized commands', () => {
    expect(getUniqueTechniques(['echo hi', 'echo bye'])).toHaveLength(0);
  });

  it('deduplicates repeated techniques', () => {
    const commands = ['nmap target', 'nmap -p 80 target', 'nmap -sC target'];
    const techniques = getUniqueTechniques(commands);
    expect(techniques).toHaveLength(1);
  });
});

// =============================================================================
// calculateTacticBreakdown
// =============================================================================

describe('calculateTacticBreakdown', () => {
  it('calculates percentage breakdown by tactic', () => {
    const techniques = [
      ATTACK_TECHNIQUES['T1592'],       // Reconnaissance
      ATTACK_TECHNIQUES['T1595.002'],   // Reconnaissance
      ATTACK_TECHNIQUES['T1190'],       // Initial Access
    ];
    const breakdown = calculateTacticBreakdown(techniques);

    expect(breakdown['Reconnaissance'].count).toBe(2);
    expect(breakdown['Reconnaissance'].percentage).toBeCloseTo(66.67, 0);
    expect(breakdown['Initial Access'].count).toBe(1);
    expect(breakdown['Initial Access'].percentage).toBeCloseTo(33.33, 0);
  });

  it('handles null techniques gracefully', () => {
    const techniques = [ATTACK_TECHNIQUES['T1190'], null, null];
    const breakdown = calculateTacticBreakdown(techniques);
    expect(breakdown['Initial Access'].count).toBe(1);
    expect(breakdown['Initial Access'].percentage).toBe(100);
  });

  it('returns empty object for empty input', () => {
    expect(calculateTacticBreakdown([])).toEqual({});
  });

  it('tracks unique technique IDs per tactic', () => {
    const techniques = [
      ATTACK_TECHNIQUES['T1595.002'],
      ATTACK_TECHNIQUES['T1595.003'],
    ];
    const breakdown = calculateTacticBreakdown(techniques);
    expect(breakdown['Reconnaissance'].techniques).toContain('T1595.002');
    expect(breakdown['Reconnaissance'].techniques).toContain('T1595.003');
  });
});

// =============================================================================
// classifyCommand (legacy methodology mapping)
// =============================================================================

describe('classifyCommand', () => {
  it('maps exploitation commands to Exploitation', () => {
    expect(classifyCommand("curl -d \"' OR '1'='1\"")).toBe('Exploitation');
  });

  it('maps nmap to Vulnerability Scanning', () => {
    expect(classifyCommand('nmap -sV target')).toBe('Vulnerability Scanning');
  });

  it('maps curl to Reconnaissance', () => {
    expect(classifyCommand('curl http://target')).toBe('Reconnaissance');
  });

  it('maps whoami to Post-Exploitation', () => {
    expect(classifyCommand('whoami')).toBe('Post-Exploitation');
  });

  it('maps flag reading to Data Exfiltration', () => {
    expect(classifyCommand('cat flag.txt')).toBe('Data Exfiltration');
  });

  it('maps agent inspection to Agent Environment', () => {
    expect(classifyCommand('which nmap')).toBe('Agent Environment');
  });

  it('returns Unknown for unrecognized commands', () => {
    expect(classifyCommand('echo hello')).toBe('Unknown');
  });
});

// =============================================================================
// extractTool
// =============================================================================

describe('extractTool', () => {
  it('extracts curl from curl commands', () => {
    expect(extractTool('curl http://target')).toBe('curl');
  });

  it('extracts nmap from nmap commands', () => {
    expect(extractTool('nmap -sV target')).toBe('nmap');
  });

  it('extracts sqlmap', () => {
    expect(extractTool('sqlmap -u http://target/page?id=1')).toBe('sqlmap');
  });

  it('extracts gobuster', () => {
    expect(extractTool('gobuster dir -u http://target')).toBe('gobuster');
  });

  it('extracts python from python3 (matches python first)', () => {
    expect(extractTool('python3 exploit.py')).toBe('python');
  });

  it('extracts cat', () => {
    expect(extractTool('cat /etc/passwd')).toBe('cat');
  });

  it('falls back to first word for unknown commands', () => {
    expect(extractTool('customtool --flag')).toBe('customtool');
  });

  it('returns unknown for empty string', () => {
    expect(extractTool('')).toBe('unknown');
  });
});

// =============================================================================
// wasSuccessful
// =============================================================================

describe('wasSuccessful', () => {
  it('returns true for output containing flag', () => {
    expect(wasSuccessful('cat flag.txt', 'KX{abc123}')).toBe(true);
  });

  it('returns true for 200 OK response', () => {
    expect(wasSuccessful('curl http://target', 'HTTP/1.1 200 OK')).toBe(true);
  });

  it('returns true for success message', () => {
    expect(wasSuccessful('curl http://target', 'Login success')).toBe(true);
  });

  it('returns false for 404 response', () => {
    expect(wasSuccessful('curl http://target/missing', 'Not Found 404')).toBe(false);
  });

  it('returns false for connection refused', () => {
    expect(wasSuccessful('curl http://target:9999', 'connection refused')).toBe(false);
  });

  it('returns false for error messages', () => {
    expect(wasSuccessful('curl http://target', 'Error: something went wrong')).toBe(false);
  });

  it('returns false for access denied', () => {
    expect(wasSuccessful('curl http://target/admin', 'Access denied')).toBe(false);
  });

  it('returns true for non-empty output without indicators', () => {
    expect(wasSuccessful('ls', 'file1.txt\nfile2.txt')).toBe(true);
  });

  it('returns false for empty output', () => {
    expect(wasSuccessful('cat missing.txt', '')).toBe(false);
  });

  it('prioritizes success indicators over failure indicators', () => {
    // Output contains both "flag" (success) and "error" — success wins
    expect(wasSuccessful('cat flag.txt', 'flag found despite error in parsing')).toBe(true);
  });
});
