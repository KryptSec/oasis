# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in OASIS, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **security@kryptsec.com** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide an estimated timeline for a fix.

## Scope

OASIS is a benchmarking tool that runs AI agents in isolated Docker containers. Security concerns include:

- Container escape vulnerabilities
- API key exposure
- Challenge definition injection
- CLI argument injection

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
