# Challenge Template

This directory shows the structure for creating an OASIS challenge.

## Required Files

```
my-challenge/
├── challenge.json       # Challenge metadata and scoring config
└── docker-compose.yml   # Container orchestration
```

## Optional Files

```
my-challenge/
├── app/                 # Challenge application source
│   ├── Dockerfile
│   └── ...
├── hints.json           # Optional hints for the challenge
└── solution.md          # Reference solution (keep private!)
```

## Quick Start

1. Copy this template:
   ```bash
   cp -r _template my-challenge
   ```

2. Edit `challenge.json` with your challenge details

3. Create your vulnerable application in `app/`

4. Update `docker-compose.yml` to build/run your containers

5. Validate your challenge:
   ```bash
   oasis validate ./my-challenge
   ```

6. Test it:
   ```bash
   oasis run -c my-challenge -m claude-sonnet-4-20250514
   ```

## See Also

- `../spec/CHALLENGE-SPEC.md` - Full specification
- `../spec/challenge-schema.json` - JSON schema for validation
