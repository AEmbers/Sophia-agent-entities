# 01 — use the public Remote entrypoint

**What to build:** A Client build resolves the Team Remote through the package's public subpath, so the Client and generated artifacts can evolve behind one declared entrypoint without a relative path into another package's `lib/` directory.

**Blocked by:** None — resolved
**Status:** complete — landed in the single architecture commit on top of `021af8f` (2026-09-15)

- [x] Client runtime import uses the public Team Remote subpath and no longer reaches into another package's generated directory by relative path.
- [x] The redundant declaration-only side-effect import is removed; the generated type facade resolves through the existing public path mappings.
- [x] The bundler resolution of that public path is made explicit rather than left to a mapping that targets types, with no generated facade edited by hand.
- [x] Typecheck, package build, and browser acceptance pass; the diff does not alter Remote behavior or add a second authority.

## What actually unblocked it

Two earlier attempts failed, and the reason was not what it first appeared to be.

**The real root cause was a working-directory bug, not a resolution-priority problem.** The pre-existing
`resolve('../../../packages/agent-team/lib/typert.remote-client.js')` target in
`packages/client-agent-team/tsdown.config.ts` was written as if it were evaluated from the repository root,
but `scripts/build-client.mjs` runs tsdown with `cwd: packages/client-agent-team` — one level deeper. The
target therefore resolved to `<repo-parent>/packages/...`, which does not exist. It never broke a build only
because no source file imported the public subpath, so the alias was never consulted.

**Correction to an earlier diagnosis recorded here:** this ticket previously claimed the alias was "dead
code" and that rolldown ignored `resolve.alias` entirely. That was a wrong inference from a correct
observation. Replacing the alias target with a nonexistent path changed nothing *because the alias was never
reached* — the source import was relative at the time — not because aliases are ignored. The measured facts
were right; the mechanism attributed to them was not.

## The fix

1. `packages/client-agent-team/src/client/index.ts` imports
   `@wowyuarm/dsh-agent-team/remote` — a declared subpath — instead of climbing into another package's
   generated directory. The declaration-only `.d.ts` import is gone.
2. `packages/client-agent-team/tsdown.config.ts` resolves that specifier through an explicit `resolveId`
   plugin, with the target anchored to `import.meta.dirname` so it can never depend on the process cwd.
   A plain `resolve.alias` was not enough: tsdown reads the client's tsconfig `paths`, whose `/remote` entry
   targets the generated `.d.ts` for the type facets, and that mapping is what resolves this specifier.
   The plugin pins the runtime artifact — the one the package's own `./remote` export declares as `default`.
3. No generated facade was touched; `scripts/sync-paths.mjs` was not modified.

## Verification

- `npm run typecheck` — green (the type facets still resolve through the tsconfig `paths` mapping).
- `npm run build` — green. **The client bundle is 538.20 kB, byte-for-byte the same size as before the
  change**, which is the evidence that the entrypoint swap did not alter emitted behavior.
- `npm run test:browser` — green (real Web end-to-end journey, 1 passed).
- `npm test` — green (573 passed | 1 skipped), including the new `check:boundaries` gate described below.

## Companion guard

`scripts/check-package-boundaries.mjs` (`npm run check:boundaries`, wired into `npm test`) now fails when a
file under `packages/*/src/` reaches another package by an escaping relative specifier, so this defect cannot
return silently. `import type` is exempt, and test files are out of scope because they deliberately wire
directories together.

The guard's first version was itself broken and worth remembering: the type-only exemption used a `[^;]*`
character class, which spans newlines, so it swallowed a whole multi-line import block — including the very
violation the check existed to find. The check passed while enforcing nothing. It is now statement-based
(`\bimport\s*(type\s+)?…`) instead of relying on one multiline regular expression.
