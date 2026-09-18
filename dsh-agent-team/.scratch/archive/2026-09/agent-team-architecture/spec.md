# Architecture and layout decision snapshot

**Status:** design direction confirmed; implementation scope is split across the next two releases.

## Problem

The repository has accumulated files, but file count is not the main failure. The three package roots are runtime/build seams. The existing `agent-team/src` modules are mostly earned seams with their own state, invariants, or Harness adaptation. The real maintenance risk is that package ownership and extension rules are partly implicit, while one Client import bypasses an existing public Remote subpath.

## Confirmed architecture

```text
packages/agent-team
  Host authority, append-only ledger, projections, lifecycle, Remote declarations
        |
        +-- packages/tool-agent-team
        |     model-facing Team tool adapters and renderers
        |
        +-- packages/client-agent-team
              typed Remote client and Team presentation
```

`packages/agent-team/src/index.ts` is the Host composition root and the Remote authorization/notification adapter. It is large because it coordinates ledger, handles, lifecycle, notifications, recovery, and the existing coordinators. `ledger.ts` keeps operation-kind semantics, replay validation, projection application, and ledger queries together; a new operation is a deliberate vertical slice through the type, ledger, Host, invariant, spec, request/result, docs, and tests surfaces.

The existing deep modules remain separate: `member-runtime.ts` owns per-Member runtime state, `context-management.ts` owns context rollover coordination, `pressure-policy.ts` owns pressure policy, `recovery.ts` owns recovery bookkeeping, and the Session reader/remediation/cursor modules own their respective Harness seams. Do not replace these with generic folders or merge them into the composition root.

`types.ts` remains the public type barrel while `types/entities.ts`, `types/operations.ts`, and `types/requests-results.ts` keep type concerns separated. The package split and this type split are both deliberate; more nesting is not automatically more clarity.

## Dependency direction

- Host owns Team authority and must not import Client or tool implementation internals.
- Tool adapters resolve Host at execution time and consume the public Host/types subpaths.
- Client consumes typed Remote, public types, and public Harness Client slots; it must not reach into Host generated artifacts through relative paths.
- Generated Typert and TypeScript facade files are outputs, not new architecture layers.
- A new seam is earned by a second adapter or by a stateful/deep module with a small interface. A thin rename/forwarder stays inline or is deleted.

## Two-release delivery

### Release N+1: make the current shape explicit

1. Correct the Client Remote import to use the existing public subpath and remove the redundant declaration side-effect import.
2. Document package ownership, the flat Host `src` layout, the four script categories, and the rule against speculative generic folders.
3. Document the Host-operation extension checklist and correct the workspace wording without changing pnpm configuration.
4. Optionally land the independent Client settings forwarder cleanup as its own small cleanup Task; it is not a prerequisite for the architecture guardrails.

### Release N+2: refactor only behind a real extension

When the next Member-level capability is selected, first identify which state it owns and move that state behind `MemberRuntime` or another earned owner. Only then reassess an activation module. Extracting `member-activation.ts` before that point is rejected: the current activation path touches many independent owners and would expose a large dependency bag rather than hide complexity.

The second release may instead spend its budget on the actual new capability. The architecture work must not invent a refactor when no new caller or adapter exists.

## Non-goals

- No wholesale `agent-team/src` directory rearrangement.
- No merging of the three packages.
- No generic `services/`, `utils/`, or `adapters/` layer.
- No immediate `member-activation.ts` extraction.
- No pnpm workspace configuration change merely because package directories do not contain independent manifests.
- No broad import-graph test when the one confirmed bypass can be removed at its source and the remaining rules can be documented first.

## Evidence

- The source tree has about 2.8k lines in `index.ts` and 4k in `ledger.ts`; their method counts reflect composition and authority responsibilities rather than a single thin forwarding layer.
- The repository has one confirmed pure Client forwarder (`TeamSettings`) and one dead settings-side field; these are suitable for an independent cleanup.
- The Client bundler now resolves the public Remote subpath explicitly, with its target anchored to the config file rather than the process working directory. The earlier `resolve.alias` form was misdirected: tsdown runs from `packages/client-agent-team`, so its `../../../` target pointed outside the repository. Because no source file imported the public subpath at the time, the misdirection never surfaced as a build failure. This corrects an earlier claim in this snapshot that the alias was ignored by the bundler.
- Independent audits by Aster (implementation/extension) and Cole (deletion/simplification) agree that the package seams and stateful modules are earned, while activation extraction is premature.
