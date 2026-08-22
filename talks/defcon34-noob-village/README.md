# Artificial Cleverness, Real Harnesses

**How we benchmark offensive AI agents — and why the harness is half the story.**
DEF CON · Noob Village · Marshall Livingston, Founder & CEO, [Kryptsec](https://kryptsec.com)

18 slides on what a captured flag does and does not tell you, built on real
[OASIS](https://github.com/kryptsec/oasis) run data — two agents solving the same
SQL-injection challenge by different paths, and what each run lets you inspect.

## Slides

- **[Open the deck](./artificial-cleverness.html)** — self-contained HTML, works offline. Arrow keys to navigate, `S` for speaker notes.
- **[PowerPoint](./artificial-cleverness.pptx)** — editable text and shapes, speaker notes included.

## The argument

A flag is one bit: it says a success condition fired. It does not say whether the
agent was competent or lucky, whether the model or the harness earned the result,
or whether the behavior would repeat. The scoring is deterministic; the agent is
not. So the trajectory — what the agent stated it observed, what it actually ran,
and what came back — is the part worth capturing.

## Run it yourself

```bash
npm install -g @kryptsec/oasis
oasis
```

Everything in the deck came from OASIS running locally against controlled Docker
targets. Code, challenges, and scoring are open — including the parts that are
still wrong.

- Runner: <https://github.com/kryptsec/oasis>
- Challenges: <https://github.com/kryptsec/oasis-challenges>

## A note on the claims

The deck is deliberately explicit about what is and is not shipped — flag
verification behavior on public `main`, work that exists only on a local branch,
and what the published 100-run cohort can and cannot support. Those statements
were accurate as of the talk. Check the repo for current state.

Licensed MIT, same as OASIS. Corrections welcome — the measurement is the thing
most worth attacking.
