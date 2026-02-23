# Changelog

All notable changes to OASIS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.1] - 2026-02-23

### Fixed

- KSM score could exceed 100 when rubric total exceeded 100 points (#29)
- Ollama benchmarks failed with missing OPENAI_API_KEY error (#28)
- Updated provider model lists: added Gemini 3 Flash, Grok 3/4

## [0.1.0] - 2026-02-16

### Added

- CLI tool with commands: `run`, `analyze`, `results`, `report`, `challenges`, `config`, `validate`, `providers`
- Multi-provider support: Anthropic, OpenAI, xAI, Google, Ollama, custom endpoints
- LLM-powered post-run analysis with MITRE ATT&CK mapping
- Kryptsec Scoring Model (KSM) with objective + qualitative rubric scoring
- Multiple report formats: terminal, text, JSON, markdown
- Challenge validation against JSON schema
- Rate-limit retry with exponential backoff
- Results summary with OWASP category grouping (`oasis results summary`)
- Challenge comparison view (`oasis results compare --challenge <id>`)
- XDG-compliant configuration (`~/.config/oasis/`)
- 153 automated tests (unit + E2E)
- CI/CD pipeline (GitHub Actions)
