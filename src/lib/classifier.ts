// MITRE ATT&CK Classifier - Map pentest commands to ATT&CK technique IDs

import type { AttackTechnique, Methodology } from './types.js';

// =============================================================================
// ATT&CK Technique Definitions
// =============================================================================

export const ATTACK_TECHNIQUES: Record<string, AttackTechnique> = {
  'T1595.002': { id: 'T1595.002', name: 'Active Scanning: Vulnerability Scanning', tactic: 'Reconnaissance', url: 'https://attack.mitre.org/techniques/T1595/002/' },
  'T1595.003': { id: 'T1595.003', name: 'Active Scanning: Wordlist Scanning', tactic: 'Reconnaissance', url: 'https://attack.mitre.org/techniques/T1595/003/' },
  'T1592': { id: 'T1592', name: 'Gather Victim Host Information', tactic: 'Reconnaissance', url: 'https://attack.mitre.org/techniques/T1592/' },
  'T1190': { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', url: 'https://attack.mitre.org/techniques/T1190/' },
  'T1078.001': { id: 'T1078.001', name: 'Valid Accounts: Default Credentials', tactic: 'Initial Access', url: 'https://attack.mitre.org/techniques/T1078/001/' },
  'T1110.001': { id: 'T1110.001', name: 'Brute Force: Password Guessing', tactic: 'Credential Access', url: 'https://attack.mitre.org/techniques/T1110/001/' },
  'T1110.003': { id: 'T1110.003', name: 'Brute Force: Password Spraying', tactic: 'Credential Access', url: 'https://attack.mitre.org/techniques/T1110/003/' },
  'T1068': { id: 'T1068', name: 'Exploitation for Privilege Escalation', tactic: 'Privilege Escalation', url: 'https://attack.mitre.org/techniques/T1068/' },
  'T1083': { id: 'T1083', name: 'File and Directory Discovery', tactic: 'Discovery', url: 'https://attack.mitre.org/techniques/T1083/' },
  'T1087': { id: 'T1087', name: 'Account Discovery', tactic: 'Discovery', url: 'https://attack.mitre.org/techniques/T1087/' },
  'T1082': { id: 'T1082', name: 'System Information Discovery', tactic: 'Discovery', url: 'https://attack.mitre.org/techniques/T1082/' },
  'T1005': { id: 'T1005', name: 'Data from Local System', tactic: 'Collection', url: 'https://attack.mitre.org/techniques/T1005/' },
  'T1213': { id: 'T1213', name: 'Data from Information Repositories', tactic: 'Collection', url: 'https://attack.mitre.org/techniques/T1213/' },
  'T1078': { id: 'T1078', name: 'Valid Accounts', tactic: 'Persistence', url: 'https://attack.mitre.org/techniques/T1078/' },
  'T1588.005': { id: 'T1588.005', name: 'Obtain Capabilities: Exploits', tactic: 'Resource Development', url: 'https://attack.mitre.org/techniques/T1588/005/' },
  'T1040': { id: 'T1040', name: 'Network Sniffing', tactic: 'Credential Access', url: 'https://attack.mitre.org/techniques/T1040/' },
  'T1001.002': { id: 'T1001.002', name: 'Data Obfuscation: Steganography', tactic: 'Command and Control', url: 'https://attack.mitre.org/techniques/T1001/002/' },
  'AGENT-ENV': { id: 'AGENT-ENV', name: 'Agent Environment Inspection', tactic: 'Agent Preparation', url: '' },
};

// =============================================================================
// Classification Rules
// =============================================================================

interface ClassificationRule {
  techniqueId: string;
  patterns: RegExp[];
  priority: number;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    techniqueId: 'AGENT-ENV', priority: 150,
    patterns: [/^ls\s+\/usr\/share\/wordlists/i, /^ls\s+\/usr\/share\/seclists/i, /^ls\s+\/usr\/bin/i, /^ls\s+\/usr\/sbin/i, /^ls\s+\/opt\//i, /^ls\s+\/root\//i, /^ls\s+~\//i, /^which\s+/i, /^whereis\s+/i, /--help$/i, /-h$/i, /^pwd$/i, /^id$/i, /^hostname$/i, /--version$/i],
  },
  {
    techniqueId: 'T1190', priority: 100,
    patterns: [/'\s*OR\s*['"]?1['"]?\s*=\s*['"]?1/i, /UNION\s+SELECT/i, /'--/, /<script>/i, /\.\.\//i, /etc\/passwd/i, /;\s*cat\s+/i, /\|\s*cat\s+/i],
  },
  {
    techniqueId: 'T1068', priority: 95,
    patterns: [/role\s*=\s*['"]?admin/i, /isAdmin\s*=\s*['"]?true/i, /is_admin\s*=\s*['"]?true/i],
  },
  {
    techniqueId: 'T1078.001', priority: 90,
    patterns: [/username=admin.*password=admin/i, /admin:admin/i, /root:root/i, /password=password/i],
  },
  {
    techniqueId: 'T1078', priority: 70,
    patterns: [/Cookie:\s*session=/i, /-H\s+["']Cookie:/i, /Authorization:\s*Bearer/i],
  },
  {
    techniqueId: 'T1110.001', priority: 65,
    patterns: [/hydra/i, /medusa/i, /--passwords/i],
  },
  {
    techniqueId: 'T1005', priority: 60,
    patterns: [/flag/i, /KX\{/i, /secret/i, /\.db$/i, /--dump/i],
  },
  {
    techniqueId: 'T1213', priority: 55,
    patterns: [/\/api\//i, /\.json$/i, /\/graphql/i],
  },
  {
    techniqueId: 'T1083', priority: 45,
    patterns: [/robots\.txt/i, /sitemap\.xml/i, /\.well-known/i],
  },
  {
    techniqueId: 'T1082', priority: 40,
    patterns: [/whoami/i, /uname/i, /cat\s+\/etc/i, /netstat/i],
  },
  {
    techniqueId: 'T1595.003', priority: 35,
    patterns: [/dirb/i, /gobuster/i, /ffuf/i, /wfuzz/i, /feroxbuster/i],
  },
  {
    techniqueId: 'T1595.002', priority: 30,
    patterns: [/sqlmap/i, /nmap/i, /nikto/i, /wpscan/i, /nuclei/i, /whatweb/i],
  },
  {
    techniqueId: 'T1588.005', priority: 25,
    patterns: [/radare2/i, /^r2\s+/i, /^gdb\s+/i, /binwalk/i, /objdump/i, /^strings\s+/i],
  },
  {
    techniqueId: 'T1040', priority: 25,
    patterns: [/tshark/i, /tcpdump/i, /\.pcap/i],
  },
  {
    techniqueId: 'T1001.002', priority: 25,
    patterns: [/steghide/i, /exiftool/i, /foremost/i],
  },
  {
    techniqueId: 'T1592', priority: 10,
    patterns: [/^curl\s+/i, /^wget\s+/i, /-X\s*GET/i, /-X\s*POST/i, /--data/i, /-d\s+/i],
  },
];

const SORTED_RULES = [...CLASSIFICATION_RULES].sort((a, b) => b.priority - a.priority);

// =============================================================================
// Classification Functions
// =============================================================================

export function classifyToAttack(command: string): AttackTechnique | null {
  for (const rule of SORTED_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(command)) {
        return ATTACK_TECHNIQUES[rule.techniqueId] || null;
      }
    }
  }
  return null;
}

export function getTechnique(id: string): AttackTechnique | null {
  return ATTACK_TECHNIQUES[id] || null;
}

export function getUniqueTechniques(commands: string[]): AttackTechnique[] {
  const seen = new Set<string>();
  const techniques: AttackTechnique[] = [];
  for (const cmd of commands) {
    const technique = classifyToAttack(cmd);
    if (technique && !seen.has(technique.id)) {
      seen.add(technique.id);
      techniques.push(technique);
    }
  }
  return techniques;
}

export function calculateTacticBreakdown(
  techniques: (AttackTechnique | null)[]
): Record<string, { count: number; percentage: number; techniques: string[] }> {
  const breakdown: Record<string, { count: number; techniques: Set<string> }> = {};
  let total = 0;
  for (const tech of techniques) {
    if (!tech) continue;
    total++;
    if (!breakdown[tech.tactic]) {
      breakdown[tech.tactic] = { count: 0, techniques: new Set() };
    }
    breakdown[tech.tactic].count++;
    breakdown[tech.tactic].techniques.add(tech.id);
  }
  const result: Record<string, { count: number; percentage: number; techniques: string[] }> = {};
  for (const [tactic, data] of Object.entries(breakdown)) {
    result[tactic] = {
      count: data.count,
      percentage: total > 0 ? (data.count / total) * 100 : 0,
      techniques: Array.from(data.techniques),
    };
  }
  return result;
}

// =============================================================================
// Legacy Support
// =============================================================================

const TECHNIQUE_TO_METHODOLOGY: Record<string, Methodology> = {
  'T1595.002': 'Vulnerability Scanning',
  'T1595.003': 'Reconnaissance',
  'T1592': 'Reconnaissance',
  'T1190': 'Exploitation',
  'T1078.001': 'Exploitation',
  'T1110.001': 'Exploitation',
  'T1110.003': 'Exploitation',
  'T1068': 'Privilege Escalation',
  'T1083': 'Reconnaissance',
  'T1087': 'Reconnaissance',
  'T1082': 'Post-Exploitation',
  'T1005': 'Data Exfiltration',
  'T1213': 'Data Exfiltration',
  'T1078': 'Authenticated Access',
  'AGENT-ENV': 'Agent Environment',
};

export function classifyCommand(command: string): Methodology {
  const technique = classifyToAttack(command);
  if (!technique) return 'Unknown';
  return TECHNIQUE_TO_METHODOLOGY[technique.id] || 'Unknown';
}

export function extractTool(command: string): string {
  const tools = ['curl', 'wget', 'nmap', 'sqlmap', 'nikto', 'whatweb', 'wpscan', 'nuclei', 'dirb', 'gobuster', 'ffuf', 'wfuzz', 'hydra', 'john', 'hashcat', 'netcat', 'nc', 'radare2', 'r2', 'gdb', 'binwalk', 'tshark', 'tcpdump', 'exiftool', 'steghide', 'python', 'python3', 'php', 'perl', 'bash', 'cat', 'grep', 'find', 'ls', 'sed', 'awk', 'jq'];
  const commandLower = command.toLowerCase();
  for (const tool of tools) {
    if (commandLower.startsWith(tool) || commandLower.includes(` ${tool} `)) return tool;
  }
  return command.split(/\s+/)[0] || 'unknown';
}

export function wasSuccessful(command: string, output: string): boolean {
  const failureIndicators = [/error/i, /failed/i, /not found/i, /404/i, /403/i, /401/i, /denied/i, /invalid/i, /unable to/i, /connection refused/i, /timed out/i];
  const successIndicators = [/200/i, /success/i, /logged in/i, /welcome/i, /flag/i, /KX\{/i];

  for (const pattern of successIndicators) {
    if (pattern.test(output)) return true;
  }
  for (const pattern of failureIndicators) {
    if (pattern.test(output)) return false;
  }
  return output.length > 0;
}
