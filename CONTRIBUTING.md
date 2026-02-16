# Contributing to OASIS

Thank you for your interest in contributing to OASIS! This guide will help you get started.

## Ways to Contribute

### 1. Create New Challenges

The most impactful way to contribute is by creating new benchmark challenges.

**Getting started:**
```bash
# Copy the challenge template
cp -r challenges/_template challenges/my-challenge

# Edit challenge.json with your challenge config
# Edit docker-compose.yml with your vulnerable target

# Validate your challenge
oasis validate ./challenges/my-challenge
```

**Challenge requirements:**
- Must have a `challenge.json` matching the schema in `spec/challenge-schema.json`
- Must have a `docker-compose.yml` with at least a target service and a kali agent container
- Flag format: `KX{hex_string}` (e.g., `KX{a1b2c3d4}`)
- Must be solvable within the defined time/iteration limits
- Should target realistic, common vulnerability classes

See `spec/CHALLENGE-SPEC.md` for the full challenge specification.

### 2. Report Bugs

Open an issue on GitHub with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (OS, Node version, Docker version)

### 3. Improve Documentation

Documentation improvements are always welcome. Fix typos, clarify instructions, or add examples.

### 4. Code Contributions

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run the build: `npm run build`
5. Test your changes
6. Submit a pull request

## Development Setup

```bash
# Clone and install
git clone https://github.com/kryptsec/oasis.git
cd oasis
npm install

# Build
npm run build

# Run locally
node dist/index.js --help
```

## Code Style

- TypeScript with strict mode
- ESM modules (no CommonJS)
- Minimal dependencies

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
