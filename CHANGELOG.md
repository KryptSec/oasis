# Changelog

All notable changes to OASIS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.3] - 2026-02-24

### Added

- Polished CLI output: gradient banners, boxed layouts, cli-table3 tables throughout
- Live model fetching from provider APIs (config flow + run wizard)
- Share card report format (`oasis report <id> -f share`) — compact markdown for Discord/GitHub
- Standalone HTML report format (`oasis report <id> -f html`) — dark-themed, no external deps
- Clipboard support (`oasis report <id> -f share --clipboard`)

### Fixed

- ATT&CK technique classification now runs on every command during benchmarks (was always null)
- Analyzer backfills step-level techniques from LLM stepsUsed mapping
- Updated provider model lists to current (Claude Opus 4.6, o3, Grok 4, Gemini 2.5 Pro)

### Changed

- Interactive run wizard uses live model list with spinner + fallback to examples
- Back-navigation wizard integrated with live model fetching
- `executeAndRecordStep` helper now includes technique classification
- Bumped `@anthropic-ai/sdk` ^0.71.2 → ^0.78.0
- Bumped `openai` ^4.0.0 → ^6.25.0 (added type guard for v6 union type in runner)

## [0.1.2] - 2026-02-23

### Fixed

- CLI `--version` now reads from package.json instead of hardcoded value
- Docker auto-start on macOS when daemon isn't running
- Per-image ARM64 fallback (only emulates containers that need it)

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
