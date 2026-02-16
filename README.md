# OASIS

**Offensive AI Security Intelligence Standard** — Open-source AI security benchmarking.

Measure how well AI models perform offensive security tasks: vulnerability discovery, exploitation, privilege escalation, and more. Get enterprise-grade analysis with MITRE ATT&CK mapping, behavioral scoring, and detailed reports.

## Requirements

- **Node.js** >= 18.0.0
- **Docker Desktop** (must be running)
- **AI API Key** — One of:
  - Anthropic (Claude models)
  - OpenAI (GPT models)
  - xAI (Grok models)
  - Google (Gemini models)
  - Ollama (local models, no key required)

## Installation

```bash
npm install -g @kryptsec/oasis
```

Or run directly:
```bash
npx @kryptsec/oasis --help
```

## Quick Start

### 1. Configure your API key

```bash
oasis config set api-key anthropic sk-ant-xxx
oasis config set default-model claude-sonnet-4-5-20250929
```

### 2. Get a challenge

Challenges are **separate from the CLI** — they're community-built, open-source, and you can create your own.

```bash
# Clone a challenge repo (or use your own)
git clone https://github.com/kryptsec/oasis-challenges.git challenges

# Or just create a challenge directory with a challenge.json + docker-compose.yml
```

The CLI looks for challenges in `./challenges/` relative to your current directory.

### 3. Start the challenge environment

```bash
cd challenges/gatekeeper
docker-compose up -d
cd ../..
```

### 4. Run a benchmark

```bash
oasis run -c gatekeeper -m claude-sonnet-4-5-20250929 -p anthropic
```

The agent will execute commands inside the Kali container, attempt to exploit the target, and capture the flag. After completion, analysis runs automatically using your Anthropic API key.

### 5. View results

```bash
oasis results list               # List all runs
oasis results show <run-id>      # Show run details
oasis report <run-id> --format md  # Generate markdown report
```

## Commands

### `oasis run`

Run a benchmark against a challenge.

```bash
oasis run -c <challenge-id> -m <model> [options]

Options:
  -c, --challenge <id>        Challenge ID to run (required)
  -m, --model <model>         Model to use (e.g., claude-sonnet-4-5-20250929)
  -p, --provider <name>       Provider: anthropic, openai, xai, google, ollama, custom
  -k, --api-key <key>         API key (or use config)
  -u, --api-url <url>         Custom API endpoint (for ollama/custom)
  --analyze / --no-analyze    Run analysis after completion (default: true)
  --analyzer-model <model>    Model for analysis (default: claude-sonnet-4-5-20250929)
  --analyzer-key <key>        Separate API key for analysis
  --max-iterations <n>        Override max iterations
  --report                    Print detailed report after run
  --verified                  Run on Kryptsec servers (requires login)
  --verbose                   Show detailed agent output
```

### `oasis analyze`

Run analysis on a completed benchmark run.

```bash
oasis analyze <run-id>          # Analyze a specific run
oasis analyze                   # Analyze most recent run
oasis analyze --all             # Analyze all unanalyzed runs
oasis analyze --all --reanalyze # Re-analyze all runs
```

### `oasis results`

View and manage benchmark results.

```bash
oasis results list                      # List all results
oasis results list --challenge gatekeeper  # Filter by challenge
oasis results show <run-id>             # Show run details
oasis results compare <id1> <id2>       # Compare two runs
```

### `oasis report`

Generate reports in various formats.

```bash
oasis report <run-id>                   # Terminal (colored)
oasis report <run-id> --format json     # Machine-readable JSON
oasis report <run-id> --format md       # Markdown
oasis report <run-id> --format text     # Plain text (box-drawing)
oasis report <run-id> -f md -o report.md  # Write to file
```

### `oasis challenges`

List available challenges.

```bash
oasis challenges
```

### `oasis config`

Manage configuration and API keys.

```bash
oasis config set api-key <provider> <key>
oasis config set default-model claude-sonnet-4-5-20250929
oasis config set default-provider anthropic
oasis config list
```

### `oasis validate`

Validate a challenge configuration file.

```bash
oasis validate ./my-challenge/
```

### `oasis providers`

List supported AI providers and their configuration status.

```bash
oasis providers
```

## Directory Layout

The CLI uses **your current working directory** to find challenges and store results:

```
your-project/
├── challenges/           # Challenge definitions (from community, Kryptsec, or your own)
│   ├── gatekeeper/
│   │   ├── challenge.json
│   │   └── docker-compose.yml
│   └── my-custom-challenge/
│       ├── challenge.json
│       └── docker-compose.yml
└── results/              # Benchmark results (created automatically)
    ├── a1b2c3d4.json
    └── a1b2c3d4.analysis.json
```

Override with env vars or config:
```bash
export OASIS_CHALLENGES_DIR=/path/to/my/challenges
export OASIS_RESULTS_DIR=/path/to/my/results
# Or:
oasis config set challengesDir /path/to/my/challenges
oasis config set resultsDir /path/to/my/results
```

## Configuration

Configuration is stored in `~/.config/oasis/`:

- `config.json` — Settings (default model, provider, paths, URLs)
- `credentials.json` — API keys (stored locally with restricted permissions, never transmitted)

### Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (also used for analysis) |
| `OPENAI_API_KEY` | OpenAI API key |
| `XAI_API_KEY` | xAI API key |
| `GOOGLE_API_KEY` | Google API key |
| `ANALYZER_API_KEY` | Separate key for analysis (optional) |
| `OASIS_CHALLENGES_DIR` | Override challenges directory |
| `OASIS_RESULTS_DIR` | Override results directory |

## Supported Providers

| Provider | Models | SDK |
|---|---|---|
| **Anthropic** | Claude Sonnet 4.5, Claude Sonnet 4, Haiku 3.5 | Native Anthropic SDK |
| **OpenAI** | GPT-4o, o1, o3-mini | OpenAI SDK |
| **xAI** | Grok 3, Grok 2 | OpenAI-compatible |
| **Google** | Gemini 2.0 Flash, Gemini 1.5 Pro | OpenAI-compatible |
| **Ollama** | Any local model | OpenAI-compatible |
| **Custom** | Any model via `--api-url` | OpenAI-compatible |

Aliases: `claude` → `anthropic`, `grok` → `xai`, `gemini` → `google`

## Analysis

After each run, OASIS uses an LLM (Claude by default) to generate enterprise-grade analysis:

- **MITRE ATT&CK Mapping** — Classifies each step to specific techniques and sub-techniques
- **Attack Narrative** — Executive summary and detailed narrative of the attack flow
- **Behavioral Analysis** — Classifies approach as methodical, aggressive, exploratory, or targeted
- **Strategy Scoring** — Recon quality, exploit efficiency, adaptability (0-100)
- **Rubric Evaluation** — Challenge-specific milestones, qualitative scoring, and penalty detection

Analysis requires an Anthropic API key. If you benchmark with a non-Anthropic provider, provide an Anthropic key separately:

```bash
oasis config set api-key anthropic sk-ant-xxx
```

## Creating Challenges

See `spec/CHALLENGE-SPEC.md` for the full specification.

```bash
# Copy the template
cp -r challenges/_template challenges/my-challenge

# Edit challenge.json and docker-compose.yml
# Validate
oasis validate challenges/my-challenge
```

## Output

Results are saved to the `results/` directory:

| File | Contents |
|---|---|
| `<run-id>.json` | Full benchmark results (steps, tokens, techniques) |
| `<run-id>.analysis.json` | LLM analysis (ATT&CK mapping, scoring, narrative) |

Export to other formats:
```bash
oasis report <run-id> --format json -o results.json
oasis report <run-id> --format md -o report.md
```

## Verified Runs (Kryptsec Platform)

For official leaderboard submissions, use verified mode:

```bash
oasis login                    # Authenticate via browser
oasis run --verified -c gatekeeper -m claude-sonnet-4-5-20250929
```

Verified runs execute on Kryptsec infrastructure, ensuring fair comparison.

## Development

```bash
git clone https://github.com/kryptsec/oasis.git
cd oasis
npm install
npm run build

# Run locally
node dist/index.js --help

# Development mode (tsx, no build needed)
npm run dev -- run -c gatekeeper -m claude-sonnet-4-5-20250929
```

## License

MIT — [Kryptsec](https://kryptsec.com)
