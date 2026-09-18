# 02 — document layout and Host-operation rules

**What to build:** A maintainer can add a Host operation or place a new module by following one bilingual guide that names package ownership, the existing composition root, the flat Host source layout, script categories, and the complete operation-extension checklist.

**Blocked by:** None — can start immediately
**Status:** complete — landed in `aca89c3` (2026-09-15)

- [x] Maintained English and Chinese development documentation explains the three package seams and why generic source folders are not introduced preemptively.
- [x] The documentation identifies the Host composition root, ledger operation ownership, public type barrel, and the existing deep-module seams without duplicating implementation authority.
- [x] The documentation lists the cross-layer checks for a new Host operation: types, ledger, Host/Remote, invariant, spec, request/result, tests, and maintained docs.
- [x] The inaccurate statement about `packages/*` being workspace members is corrected without changing pnpm configuration.
- [x] Documentation checks and the narrowest relevant type/test checks pass.

## What shipped

`docs/development.md` / `.zh.md` gained "Package seams and module layout" and "Adding a Host operation"; `docs/architecture.md` / `.zh.md` now mark the three directories as build/export seams of one published package and state the one-way dependency direction. The false `pnpm-workspace.yaml` sentence is corrected. `npm run duplication` and `prepack` joined the verification list.

## Two deliberate scope cuts

- The four script-category table was written and then removed before landing. It restated what `ls scripts/` already shows, nothing enforces the categories, and the table would rot as scripts move. Script placement is instead carried by the existing `scripts/` conventions and the check/run/generate naming.
- The per-module Host file list was cut to the three structural anchors (`index.ts`, `ledger.ts`, `spec.ts` + the `types.ts` barrel), because `architecture.md` already owns "which module owns what"; a second list would have been a duplicate home for one fact.

## Non-obvious finding worth keeping

`invariant.ts` registers ONE whole-ledger invariant (validated at mount and after every commit). A new operation is covered automatically once it replays, so the checklist deliberately does not tell a maintainer to add a per-operation invariant shell.

## Verification

`npm run typecheck`, `npm test` (573 passed | 1 skipped), `npm run check:docs` (112 links), and `npm run test:browser` (real Web journey) all pass on the landing commit.
