# OASIS CLI

AI Security Benchmarking Command Line Interface

## Overview

The OASIS CLI allows you to run AI security benchmarks locally against challenge environments. It measures how well AI models perform offensive security tasks like vulnerability discovery, exploitation, and privilege escalation.

## Requirements

- **Node.js** >= 18.0.0
- **Docker Desktop** (must be running)
- **Kali Docker Image** - Pull once:
  ```bash
  docker pull registry.digitalocean.com/kss-registry/oasis-kali:latest
  ```
- **AI API Key** - One of:
  - Anthropic (Claude models)
  - OpenAI (GPT models)
  - xAI (Grok models)
  - Google (Gemini models)
  - Ollama (local models, no key required)

## Directory Structure

The CLI expects to be run from within the OASIS monorepo:

```
OASIS/
├── oasis-cli/          # This CLI tool
├── oasis-agent/        # Agent that executes benchmarks (required)
├── oasis-poc/          # Docker compose for challenge environment
├── challenges/         # Challenge definitions
└── results/            # Benchmark results (created automatically)
```

## Installation

```bash
# From the oasis-cli directory
npm install
npm run build
```

After building, you can run commands using `node dist/index.js` or use the shorthand:

```bash
# Shorthand (recommended)
alias oasis='node dist/index.js'

# Or add to PATH for global use
export PATH="$PATH:$(pwd)/dist"
```

## Quick Start

### 1. Configure your API key

```bash
# For Anthropic (Claude)
node dist/index.js config set api-key anthropic sk-ant-xxx

# For OpenAI
node dist/index.js config set api-key openai sk-xxx

# For Ollama (local models)
node dist/index.js config set api-url ollama http://localhost:11434/v1
```

### 2. Start the challenge environment

```bash
cd ../oasis-poc
docker-compose up -d
```

### 3. Run a benchmark

```bash
node dist/index.js run -c gatekeeper -m claude-sonnet-4-20250514 -p anthropic

# Or with alias:
oasis run -c gatekeeper -m claude-sonnet-4-20250514 -p anthropic
```

## Commands

### `oasis run`

Run a benchmark against a challenge.

```bash
oasis run -c <challenge-id> -m <model> [options]

Options:
  -c, --challenge <id>    Challenge ID to run (required)
  -m, --model <model>     Model to use (e.g., claude-sonnet-4-20250514)
  -p, --provider <name>   Provider: anthropic, openai, xai, google, ollama
  -k, --api-key <key>     API key (or use config)
  -u, --api-url <url>     Custom API endpoint (for ollama/custom)
  --analyze               Run enterprise analysis after completion (default: true)
  --verbose               Show detailed agent output
```

### `oasis challenges`

List available challenges.

```bash
oasis challenges
```

### `oasis leaderboard`

View the public leaderboard (requires internet connection).

```bash
oasis leaderboard [--limit 10] [--json]
```

### `oasis submit`

Submit benchmark results to the leaderboard.

```bash
oasis submit <run-id>
oasis submit --file results/abc123.json
oasis submit --list  # Show recent runs
```

### `oasis config`

Manage configuration and API keys.

```bash
oasis config set api-key <provider> <key>
oasis config set default-model claude-sonnet-4-20250514
oasis config set default-provider anthropic
oasis config list
```

### `oasis validate`

Validate a challenge configuration file.

```bash
oasis validate ./my-challenge/
```

### `oasis providers`

List supported AI providers.

```bash
oasis providers
```

## Configuration

Configuration is stored in `~/.config/oasis/`:

- `config.json` - Settings (default model, provider)
- `credentials.json` - API keys (stored locally, never transmitted)

### Environment Variables

You can also use environment variables:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `XAI_API_KEY`
- `GOOGLE_API_KEY`
- `OASIS_API_URL` - Override leaderboard API endpoint

## Using with Ollama

For local models via Ollama:

```bash
# Configure Ollama endpoint
oasis config set api-url ollama http://localhost:11434/v1

# Run with a local model
oasis run -c gatekeeper -m llama3:8b -p ollama
```

## Output

Results are saved to the `results/` directory:

- `<run-id>.json` - Full benchmark results
- `<run-id>.txt` - Human-readable report
- `<run-id>.analysis.json` - Enterprise analysis (if enabled)
- `<run-id>.analysis.txt` - Analysis report

## Offline Usage

The following commands work fully offline:

- `oasis run` - Run benchmarks locally
- `oasis challenges` - List local challenges
- `oasis validate` - Validate challenge configs
- `oasis config` - Manage settings
- `oasis providers` - List providers

These commands require internet:

- `oasis leaderboard` - Fetches from oasis.kryptsec.com
- `oasis submit` - Submits to oasis.kryptsec.com

## Development

```bash
# Run in development mode (uses tsx directly, no build needed)
npm run dev -- run -c gatekeeper -m claude-sonnet-4-20250514

# Type check
npm run typecheck

# Build for production
npm run build

# After building, use the compiled version
node dist/index.js <command>
```

## License

MIT - Kryptsec
