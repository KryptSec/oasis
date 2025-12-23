# OASIS

**Offensive AI Security Intelligence Standard**

AI security benchmarking platform for measuring LLM capabilities in offensive security contexts.

## Overview

OASIS provides standardized challenges and scoring (KSS - Kryptsec Scoring System) to benchmark how well AI models perform offensive security tasks like vulnerability discovery, exploitation, and privilege escalation.

## Repository Structure

```
oasis/
├── oasis-cli/          # Command-line interface for running benchmarks
├── oasis-agent/        # Agent execution engine
├── challenges/         # Challenge definitions and templates
├── spec/               # Challenge specification and schema
└── scripts/            # Utility scripts
```

## Quick Start

### 1. Install and Build

```bash
# Install CLI
cd oasis-cli
npm install
npm run build

# Create alias (add to ~/.bashrc or ~/.zshrc)
alias oasis='node $(pwd)/dist/index.js'
cd ..

# Install agent
cd oasis-agent
npm install
cd ..
```

### 2. Pull Kali Image

```bash
docker pull registry.digitalocean.com/kss-registry/oasis-kali:latest
```

### 3. Configure API Key

```bash
oasis config set api-key anthropic sk-ant-xxx
```

### 4. Create a Challenge

See `challenges/_template/` for the structure. You'll need to:
- Create a vulnerable application
- Define challenge metadata in `challenge.json`
- Set up Docker compose to run your challenge + Kali container

### 5. Run a Benchmark

```bash
oasis run -c <challenge-id> -m claude-sonnet-4-20250514 -p anthropic
```

## Documentation

- **CLI Usage:** See `oasis-cli/README.md`
- **Challenge Spec:** See `spec/CHALLENGE-SPEC.md`
- **Scoring System:** See `spec/SCORING.md`

## Supported AI Providers

- Anthropic (Claude models)
- OpenAI (GPT models)
- xAI (Grok models)
- Google (Gemini models)
- Ollama (local models)
- Custom OpenAI-compatible endpoints

## Requirements

- Node.js >= 18.0.0
- Docker Desktop
- AI API key (or Ollama for local models)

## License

MIT

## About

Built by [Kryptsec](https://kryptsec.com) - Cybersecurity training and certification platform.
