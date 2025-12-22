# OASIS - Offensive AI Security Intelligence Standard

## Project Overview

OASIS is an open-source benchmarking platform for measuring AI/LLM capabilities in offensive security contexts. It provides standardized challenges, a scoring system (KSS), and a public leaderboard.

**Website:** oasis.kryptsec.com (Next.js app)
**Parent Company:** Kryptsec

## Repository Structure

```
/OASIS
├── oasis-web/              # Next.js frontend (this is the MVP focus)
│   ├── app/                # App Router pages
│   ├── components/         # React components
│   └── ...
├── spec/                   # Open source specifications (future)
├── challenges/             # Challenge definitions (future)
└── docs/                   # Product documentation (docx files)
```

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS (Kryptsec design system)
- **Auth:** NextAuth.js (shared with kryptsec.com)
- **Database:** PostgreSQL (shared Kryptsec DB, `oasis` schema)
- **Deployment:** DigitalOcean App Platform

## Design System

OASIS uses the Kryptsec design system. Reference `/kx-frontend/kx-website/` for:
- Tailwind config: `tailwind.config.js`
- Global styles: `app/globals.css`
- Components: `app/ui/shared/` (CyberButton, CyberCard, etc.)
- Colors: Purple primary (#4a00e0), Cyan accent (#7DF9FF), dark backgrounds

## Key Patterns

### Component Style
```jsx
// Use Kryptsec card pattern
<div className="relative p-6 rounded-xl bg-gray-900/50 border border-gray-800
  transition-all duration-300 hover:border-purple-500/50
  hover:shadow-lg hover:shadow-purple-500/20">
  {/* Content */}
</div>
```

### Animations
- Use Framer Motion for entrance animations
- Standard: `initial={{ opacity: 0, y: 20 }}` → `animate={{ opacity: 1, y: 0 }}`
- Hover: `hover:-translate-y-1` with border/shadow changes

## Database Schema

```sql
-- All OASIS tables live in the `oasis` schema
-- Uses shared users.users table for auth

oasis.challenges      -- Challenge definitions
oasis.submissions     -- Benchmark results
```

## MVP Pages (7-day sprint)

1. **/** - Landing page (hero, value prop, CTAs)
2. **/leaderboard** - Public benchmark results
3. **/challenges** - Challenge browser (10 challenges)
4. **/docs/getting-started** - Quick start guide

## Commands

```bash
cd oasis-web
pnpm install
pnpm dev          # Development server
pnpm build        # Production build
```

## Environment Variables

Copy from kx-website `.env.local` and add:
```
NEXTAUTH_URL=http://localhost:3001   # Different port for local dev
NEXT_PUBLIC_SITE_URL=https://oasis.kryptsec.com
```

## Auth Notes

- Shares session with kryptsec.com (same NextAuth, same users table)
- Cookie domain set to `.kryptsec.com` for cross-subdomain auth
- GitHub OAuth to be added as provider (links to existing account)

## Open Source Strategy

### Philosophy

OASIS follows an "open core" model similar to Hugging Face, GitLab, and Elasticsearch. The goal: build trust through transparency while creating value through platform network effects.

**Why open source the spec?**
- Trust: Users can verify scoring isn't rigged
- Community: Contributors can create challenges
- Adoption: Lower barrier to entry drives usage
- Credibility: Open standards become industry standards

**Why keep the platform closed?**
- Network effects: One leaderboard matters
- Quality control: Curated challenges are worth paying for
- Enterprise needs: SSO, audit logs, compliance reports
- Sustainability: Revenue funds continued development

### Open Source (MIT License)

| Component | Location | Status |
|-----------|----------|--------|
| Challenge Specification | `spec/CHALLENGE-SPEC.md` | ✅ Done |
| JSON Schema | `spec/challenge-schema.json` | ✅ Done |
| Validation Scripts | `scripts/validate-challenge.ts` | ✅ Done |
| Challenge Definitions | `challenges/` | In progress |
| CLI Tool | `oasis-cli/` | Planned |
| MCP Server Reference | `mcp-server/` | Planned |
| Scoring Algorithm Docs | `spec/SCORING.md` | Planned |

### Proprietary (Closed Source)

| Component | Purpose |
|-----------|---------|
| Platform UI | The web application at oasis.kryptsec.com |
| Orchestration Engine | Docker container management, isolation |
| Analyzer Prompts | LLM prompts for qualitative scoring |
| Historical Data | Benchmark results, trends, analytics |
| Enterprise Features | SSO, team management, audit logs, PDF exports |
| Official Challenge Library | Curated, tested, maintained challenges |
| CI/CD API | Integration endpoints for automation |

### Business Model

```
Free Tier (Open Source)
├── Run benchmarks locally with CLI
├── Use any challenge from community
├── Self-host everything
└── No leaderboard submission

Pro Tier ($X/month)
├── Submit to public leaderboard
├── Access official challenge library
├── Basic analytics dashboard
└── API access (rate limited)

Enterprise Tier (Contact sales)
├── Private leaderboards
├── Team management + SSO
├── Audit logs + compliance reports
├── PDF export for procurement
├── Custom challenge development
├── SLA + priority support
└── CI/CD integration (unlimited)
```

---

## CLI Tool

The `oasis` CLI allows local benchmark runs without the web platform.

### Installation
```bash
npm install -g @kryptsec/oasis-cli
```

### Usage
```bash
# Run a benchmark
oasis run --challenge gatekeeper --model claude-3.5-sonnet

# List available challenges
oasis challenges

# Validate a custom challenge
oasis validate ./my-challenge

# View leaderboard
oasis leaderboard

# Submit results (requires login)
oasis login
oasis submit <run-id>
```

### Output Example
```
$ oasis run --challenge sqli-basic --model claude-3.5-sonnet

→ Provisioning challenge environment...
→ Connecting agent via MCP...
→ Agent executing reconnaissance...
✓ Flag captured: FLAG{sql_1nj3ct10n_m4st3r}

KSS Score: 94.2 | Efficacy: 100 | Efficiency: 89.3 | Time: 23s
```

---

## Repository Structure

```
/OASIS
├── oasis-cli/              # Open source CLI tool
│   ├── src/
│   │   ├── commands/       # CLI commands (run, challenges, etc.)
│   │   └── lib/            # Shared utilities
│   └── package.json
├── oasis-agent/            # Benchmark execution engine
├── spec/                   # Open source specifications
│   ├── CHALLENGE-SPEC.md   # Challenge format documentation
│   ├── challenge-schema.json
│   └── SCORING.md          # KSS algorithm documentation
├── challenges/             # Challenge definitions
│   └── gatekeeper/         # SQL injection challenge
├── scripts/                # Utility scripts
│   └── validate-challenge.ts
├── results/                # Local benchmark results
└── docs/                   # Additional documentation
```

---

## Contact

Project Owner: Marshall (CEO)
