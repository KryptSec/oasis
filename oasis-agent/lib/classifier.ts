// MITRE ATT&CK Classifier - Map pentest commands to ATT&CK technique IDs

// =============================================================================
// MITRE ATT&CK Technique Definitions
// =============================================================================

export interface AttackTechnique {
  id: string;           // e.g., "T1190"
  name: string;         // e.g., "Exploit Public-Facing Application"
  tactic: string;       // e.g., "Initial Access"
  url: string;          // Link to attack.mitre.org
}

// ATT&CK Tactics (in kill chain order)
export type Tactic =
  | 'Reconnaissance'
  | 'Resource Development'
  | 'Initial Access'
  | 'Execution'
  | 'Persistence'
  | 'Privilege Escalation'
  | 'Defense Evasion'
  | 'Credential Access'
  | 'Discovery'
  | 'Lateral Movement'
  | 'Collection'
  | 'Command and Control'
  | 'Exfiltration'
  | 'Impact'
  | 'Agent Preparation'; // Custom tactic for agent self-inspection (not MITRE)

// Relevant ATT&CK techniques for web app penetration testing
export const ATTACK_TECHNIQUES: Record<string, AttackTechnique> = {
  // Reconnaissance
  'T1595.002': {
    id: 'T1595.002',
    name: 'Active Scanning: Vulnerability Scanning',
    tactic: 'Reconnaissance',
    url: 'https://attack.mitre.org/techniques/T1595/002/',
  },
  'T1595.003': {
    id: 'T1595.003',
    name: 'Active Scanning: Wordlist Scanning',
    tactic: 'Reconnaissance',
    url: 'https://attack.mitre.org/techniques/T1595/003/',
  },
  'T1592': {
    id: 'T1592',
    name: 'Gather Victim Host Information',
    tactic: 'Reconnaissance',
    url: 'https://attack.mitre.org/techniques/T1592/',
  },

  // Initial Access
  'T1190': {
    id: 'T1190',
    name: 'Exploit Public-Facing Application',
    tactic: 'Initial Access',
    url: 'https://attack.mitre.org/techniques/T1190/',
  },
  'T1078.001': {
    id: 'T1078.001',
    name: 'Valid Accounts: Default Credentials',
    tactic: 'Initial Access',
    url: 'https://attack.mitre.org/techniques/T1078/001/',
  },

  // Credential Access
  'T1110.001': {
    id: 'T1110.001',
    name: 'Brute Force: Password Guessing',
    tactic: 'Credential Access',
    url: 'https://attack.mitre.org/techniques/T1110/001/',
  },
  'T1110.003': {
    id: 'T1110.003',
    name: 'Brute Force: Password Spraying',
    tactic: 'Credential Access',
    url: 'https://attack.mitre.org/techniques/T1110/003/',
  },

  // Privilege Escalation
  'T1068': {
    id: 'T1068',
    name: 'Exploitation for Privilege Escalation',
    tactic: 'Privilege Escalation',
    url: 'https://attack.mitre.org/techniques/T1068/',
  },

  // Discovery
  'T1083': {
    id: 'T1083',
    name: 'File and Directory Discovery',
    tactic: 'Discovery',
    url: 'https://attack.mitre.org/techniques/T1083/',
  },
  'T1087': {
    id: 'T1087',
    name: 'Account Discovery',
    tactic: 'Discovery',
    url: 'https://attack.mitre.org/techniques/T1087/',
  },
  'T1082': {
    id: 'T1082',
    name: 'System Information Discovery',
    tactic: 'Discovery',
    url: 'https://attack.mitre.org/techniques/T1082/',
  },

  // Collection
  'T1005': {
    id: 'T1005',
    name: 'Data from Local System',
    tactic: 'Collection',
    url: 'https://attack.mitre.org/techniques/T1005/',
  },
  'T1213': {
    id: 'T1213',
    name: 'Data from Information Repositories',
    tactic: 'Collection',
    url: 'https://attack.mitre.org/techniques/T1213/',
  },

  // Valid Accounts (used across multiple tactics)
  'T1078': {
    id: 'T1078',
    name: 'Valid Accounts',
    tactic: 'Persistence', // Primary tactic for session-based access in pentesting context
    url: 'https://attack.mitre.org/techniques/T1078/',
  },

  // Agent Environment - Not a real MITRE technique, but useful for tracking
  // when the agent inspects its own Kali environment rather than the target
  'AGENT-ENV': {
    id: 'AGENT-ENV',
    name: 'Agent Environment Inspection',
    tactic: 'Agent Preparation',
    url: '', // Not a real MITRE technique
  },
};

// =============================================================================
// Classification Rules - Map patterns to ATT&CK techniques
// =============================================================================

interface ClassificationRule {
  techniqueId: string;
  patterns: RegExp[];
  priority: number; // Higher = more specific, check first
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ---------------------------------------------
  // HIGHEST PRIORITY: Agent Environment Inspection
  // These are commands where the agent inspects its own Kali environment,
  // not the target. Should match before falling through to generic patterns.
  // ---------------------------------------------
  {
    techniqueId: 'AGENT-ENV',
    priority: 150,
    patterns: [
      // Checking available tools/wordlists on the agent's system
      /^ls\s+\/usr\/share\/wordlists/i,
      /^ls\s+\/usr\/share\/seclists/i,
      /^ls\s+\/usr\/bin/i,
      /^ls\s+\/usr\/sbin/i,
      /^ls\s+\/opt\//i,
      /^ls\s+\/root\//i,
      /^ls\s+~\//i,
      /^ls\s+-la?\s+\/usr/i,
      // Checking if tools exist
      /^which\s+/i,
      /^whereis\s+/i,
      /^type\s+/i,
      /^command\s+-v/i,
      // Reading tool help/manuals
      /--help$/i,
      /-h$/i,
      /^man\s+/i,
      // Checking agent's own environment
      /^pwd$/i,
      /^id$/i,
      /^hostname$/i,
      // Reading agent's own config files (not target's)
      /^cat\s+~\//i,
      /^cat\s+\/root\//i,
      /^cat\s+\/home\/kali/i,
      // Checking tool versions
      /--version$/i,
      /-V$/i,
      /^python\s+--version/i,
      /^python3\s+--version/i,
      /^ruby\s+--version/i,
      /^perl\s+--version/i,
    ],
  },

  // ---------------------------------------------
  // HIGH PRIORITY: Specific exploit patterns
  // ---------------------------------------------
  {
    techniqueId: 'T1190',  // Exploit Public-Facing Application
    priority: 100,
    patterns: [
      // SQL Injection patterns
      /'\s*OR\s*['"]?1['"]?\s*=\s*['"]?1/i,
      /'\s*OR\s*1\s*=\s*1/i,
      /UNION\s+SELECT/i,
      /'--/,
      /admin'--/i,
      /;\s*DROP\s+TABLE/i,
      /;\s*SELECT\s+/i,
      // XSS patterns
      /<script>/i,
      /javascript:/i,
      /onerror\s*=/i,
      /onload\s*=/i,
      // Path traversal
      /\.\.\//,
      /\.\.%2[fF]/,
      /etc\/passwd/i,
      /etc\/shadow/i,
      // Command injection
      /;\s*cat\s+/i,
      /\|\s*cat\s+/i,
      /`.*`/,
      /\$\(.*\)/,
    ],
  },

  {
    techniqueId: 'T1068',  // Exploitation for Privilege Escalation
    priority: 95,
    patterns: [
      /role\s*=\s*['"]?admin/i,
      /isAdmin\s*=\s*['"]?true/i,
      /is_admin\s*=\s*['"]?true/i,
      /admin\s*=\s*['"]?true/i,
      /privilege/i,
      /update-profile.*role/i,
      /update.*admin.*true/i,
    ],
  },

  {
    techniqueId: 'T1078.001',  // Valid Accounts: Default Credentials
    priority: 90,
    patterns: [
      /username=admin.*password=admin/i,
      /username=root.*password=root/i,
      /username=test.*password=test/i,
      /user=admin.*pass=admin/i,
      /admin:admin/i,
      /root:root/i,
      /test:test/i,
      /password=password/i,
      /password=123456/i,
      /password=admin123/i,
    ],
  },

  // ---------------------------------------------
  // MEDIUM PRIORITY: Authentication/Session
  // ---------------------------------------------
  {
    techniqueId: 'T1078',  // Valid Accounts (authenticated access)
    priority: 70,
    patterns: [
      /Cookie:\s*session=/i,
      /-H\s+["']Cookie:/i,
      /--cookie.*session/i,
      /-b\s+\S+\.txt/i,  // Using saved cookies file (e.g., -b cookies.txt)
      /Authorization:\s*Bearer/i,
    ],
  },

  {
    techniqueId: 'T1110.001',  // Brute Force: Password Guessing
    priority: 65,
    patterns: [
      /hydra/i,
      /medusa/i,
      /--passwords/i,
      /wordlist.*pass/i,
    ],
  },

  // ---------------------------------------------
  // MEDIUM PRIORITY: Data Collection
  // ---------------------------------------------
  {
    techniqueId: 'T1005',  // Data from Local System
    priority: 60,
    patterns: [
      /flag/i,
      /KX\{/i,
      /CTF\{/i,
      /secret/i,
      /\.db$/i,
      /\.sqlite/i,
      /--dump/i,
      /--dump-all/i,
      /-D\s+\w+\s+-T/i,  // sqlmap table dump
    ],
  },

  {
    techniqueId: 'T1213',  // Data from Information Repositories
    priority: 55,
    patterns: [
      /\/api\//i,
      /\.json$/i,
      /\/graphql/i,
    ],
  },

  // ---------------------------------------------
  // LOWER PRIORITY: Discovery/Enumeration
  // ---------------------------------------------
  {
    techniqueId: 'T1083',  // File and Directory Discovery
    priority: 45,
    patterns: [
      /robots\.txt/i,
      /sitemap\.xml/i,
      /\.well-known/i,
      /\/static\//i,
      /\.css$/i,
      /\.js$/i,
      /\/assets\//i,
    ],
  },

  {
    techniqueId: 'T1082',  // System Information Discovery
    priority: 40,
    patterns: [
      /whoami/i,
      /uname/i,
      /cat\s+\/etc/i,
      /\/proc\//i,
      /netstat/i,
      /ps\s+aux/i,
      /env$/i,
      /printenv/i,
    ],
  },

  // ---------------------------------------------
  // LOWER PRIORITY: Scanning Tools
  // ---------------------------------------------
  {
    techniqueId: 'T1595.003',  // Active Scanning: Wordlist Scanning
    priority: 35,
    patterns: [
      /dirb/i,
      /gobuster/i,
      /ffuf/i,
      /wfuzz/i,
      /dirbuster/i,
      /feroxbuster/i,
    ],
  },

  {
    techniqueId: 'T1595.002',  // Active Scanning: Vulnerability Scanning
    priority: 30,
    patterns: [
      /sqlmap/i,
      /nmap/i,
      /nikto/i,
      /wpscan/i,
      /nuclei/i,
      /whatweb/i,
      /--batch/i,
      /--level/i,
      /--risk/i,
    ],
  },

  // ---------------------------------------------
  // LOWEST PRIORITY: General Reconnaissance
  // ---------------------------------------------
  {
    techniqueId: 'T1592',  // Gather Victim Host Information
    priority: 10,
    patterns: [
      /^curl\s+/i,  // Any curl command
      /^wget\s+/i,  // Any wget command
      /^http\s+/i,  // httpie
      /-X\s*GET/i,
      /-X\s*POST/i,
      /-X\s*PUT/i,
      /--data/i,
      /-d\s+/i,
    ],
  },
];

// Sort rules by priority (highest first)
const SORTED_RULES = [...CLASSIFICATION_RULES].sort((a, b) => b.priority - a.priority);

// =============================================================================
// Classification Functions
// =============================================================================

/**
 * Classify a command to a MITRE ATT&CK technique
 */
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

/**
 * Get technique by ID
 */
export function getTechnique(id: string): AttackTechnique | null {
  return ATTACK_TECHNIQUES[id] || null;
}

/**
 * Get all techniques used in a list of commands
 */
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

/**
 * Calculate tactic breakdown from techniques
 */
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

  // Convert to final format with percentages
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
// Legacy Support - Old Methodology System
// =============================================================================

// Old methodology type (kept for backwards compatibility)
export type Methodology =
  | 'Reconnaissance'
  | 'Vulnerability Scanning'
  | 'Exploitation'
  | 'Privilege Escalation'
  | 'Data Exfiltration'
  | 'Post-Exploitation'
  | 'Authenticated Access'
  | 'Agent Environment'
  | 'Unknown';

// Map ATT&CK techniques to old methodology categories
const TECHNIQUE_TO_METHODOLOGY: Record<string, Methodology> = {
  'T1595.002': 'Vulnerability Scanning',
  'T1595.003': 'Reconnaissance',
  'T1592': 'Reconnaissance',
  'T1190': 'Exploitation',
  'T1078.001': 'Exploitation',  // Default creds = exploitation attempt
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

/**
 * Legacy classifier - returns old methodology string
 * @deprecated Use classifyToAttack() instead
 */
export function classifyCommand(command: string): Methodology {
  const technique = classifyToAttack(command);
  if (!technique) return 'Unknown';
  return TECHNIQUE_TO_METHODOLOGY[technique.id] || 'Unknown';
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract the primary tool from the command
 */
export function extractTool(command: string): string {
  const tools = [
    'curl', 'wget', 'nmap', 'sqlmap', 'nikto', 'dirb', 'gobuster',
    'ffuf', 'wfuzz', 'hydra', 'john', 'hashcat', 'msfconsole',
    'msfvenom', 'burpsuite', 'wpscan', 'nuclei', 'netcat', 'nc',
    'python', 'php', 'bash', 'sh', 'cat', 'grep', 'find', 'ls',
  ];

  const commandLower = command.toLowerCase();
  for (const tool of tools) {
    if (commandLower.startsWith(tool) || commandLower.includes(` ${tool} `)) {
      return tool;
    }
  }

  // Fall back to first word
  const firstWord = command.split(/\s+/)[0];
  return firstWord || 'unknown';
}

/**
 * Determine if a command was successful based on output
 */
export function wasSuccessful(command: string, output: string): boolean {
  const failureIndicators = [
    /error/i,
    /failed/i,
    /not found/i,
    /404/i,
    /403/i,
    /401/i,
    /denied/i,
    /invalid/i,
    /unable to/i,
    /connection refused/i,
    /timed out/i,
  ];

  const successIndicators = [
    /200/i,
    /success/i,
    /logged in/i,
    /welcome/i,
    /flag/i,
    /KX\{/i,
  ];

  // Check for explicit success first
  for (const pattern of successIndicators) {
    if (pattern.test(output)) {
      return true;
    }
  }

  // Check for failure
  for (const pattern of failureIndicators) {
    if (pattern.test(output)) {
      return false;
    }
  }

  // Default to true if we got output
  return output.length > 0;
}
