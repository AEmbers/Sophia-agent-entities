# Contributing to dsh-sophia-entities

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh.md)

Thanks for taking the time to contribute. This repository is an external, opt-in DeepSeek Harness bundle: it publishes one package from the repository root, keeps three build targets under `packages/`, and verifies itself against a pinned Harness checkout. [`AGENTS.md`](AGENTS.md) carries the rules every change must satisfy; this page carries what a contributor needs before opening a pull request.

## Before you start

- **Set up the environment contract.** Development and verification need the adjacent Harness checkout at `../deepseek-harness`, and installs go through `corepack pnpm` — never `npm install`, which breaks the workspace symlinks. Setup, generated artifacts, and the certified-tag rule: [`docs/development/README.md`](docs/development/README.md).
- **Agree on boundary changes first.** Host authority, the Team ledger, the model-facing tool surface, and Client slot wiring are guarded by [`AGENTS.md`](AGENTS.md) and [`docs/architecture/README.md`](docs/architecture/README.md). An issue that settles the shape up front is cheaper than a rewritten pull request.
- **Reporting instead of fixing?** Use the issue templates. They route installation problems through the certified-version check, because most "broken after install" reports are a DSH version mismatch.

## Verify before you open the pull request

Run the smallest sufficient set for the change, then escalate with its surface:

| The change touches | Run |
| --- | --- |
| Markdown in `docs/` or a README pair | `npm run check:docs` |
| A skill under `packages/agent-team/core-skills/` | `npm run check:core-skills` |
| Types, Host logic, tests | `npm run typecheck` and `npm test` |
| Visible UI, Client loading, slot takeover, Remote activation | the above plus `npm run test:browser` |
| Build outputs, `exports`, manifests, release layout | the above plus `npm run build` and `npm pack --dry-run` |

`npm test` runs the generated-artifact, documentation, core-skill, and package-boundary checks before Vitest. The complete ladder — `lint` and `duplication` included — is [`docs/development/start-and-checks.md`](docs/development/start-and-checks.md) § "Verification gradient".

**Report only the checks you actually ran**, and say what each one covered. A claim nobody can reproduce costs a review round trip.

## What CI runs

A pull request runs two lanes, `ubuntu-latest` and `windows-latest`. Each lane executes the same six-step environment contract — corepack shims, pinned Harness checkout, Harness install and build, this repository's install, bundle build, path facades — and then `npm run typecheck` and `npm test`. A documentation-only push to `master` skips the gate; a pull request never does. `npm run test:browser` is deliberately not in CI, so browser acceptance stays a local step: include that evidence yourself when your change is visible. The contract and the three files that must move together with the pinned tag: [`docs/development/environments-and-install.md`](docs/development/environments-and-install.md) § "Sandbox and CI environments".

## What a pull request should contain

- **Target `master`**, and rebase your own branch when it moves. `master` history is never rewritten.
- **One Conventional Commits subject line** per commit — `type: lowercase imperative summary` (`feat`, `fix`, `chore`, `refactor`, `test`, `perf`, `docs`) — with no body. Pull requests land as one squashed commit, so the title is what history keeps.
- **Every change, not the headline one.** A body that covers half the diff makes the reviewer reverse-engineer the rest.
- **A user-visible change updates [`CHANGELOG.md`](CHANGELOG.md)** under `Unreleased`.
- **Maintained docs are bilingual pairs**: change `foo.zh.md` in the same change as `foo.md` — [`docs/AGENTS.md`](docs/AGENTS.md) routes an edit to the document that owns its facts.
- **Evidence for visible changes**: screenshots at desktop and 390×844, plus keyboard/focus and dialog/menu states, per [`docs/frontend-design/README.md`](docs/frontend-design/README.md).
- **Generated files stay generated**: never hand-edit `packages/agent-team/lib/typert.*` or the generated `tsconfig*.json` path facades — change `scripts/sync-paths.mjs` and regenerate.
- **Do not modify the adjacent Harness checkout.** A change that needs one belongs upstream, or behind a public extension point.
- **Flaky tests**: name the race and prove it — a deterministic reproduction beats a retry, and a retry over a genuine loss hides the defect that caused it.
- **Nothing incidental**: no credentials, temporary profiles, browser overlays, generated test files, browser artifacts, or build residue. Keep `git diff --check` clean.

## How review works here

Day-to-day work happens in Agent Team Threads, where a change is reviewed alongside the evidence behind it; some commits and reviews are authored by the team's agent members, and automated pull requests may arrive from the `hoplite` bot. Reviews ask for evidence rather than style. Merges are squash commits on `master`, and releases are batched rather than continuous — [`docs/development/environments-and-install.md`](docs/development/environments-and-install.md) § "Profiles and release cadence".

Unsure whether a change is wanted? Open an issue first; it is cheaper than a rejected pull request.
