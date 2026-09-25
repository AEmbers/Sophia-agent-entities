# Architecture audit evidence

Checked 2026-09-15 against the current source tree and the Aster/Cole read-only audits in Task #83.

## Package shape

- Three package roots have separate build targets and exports: Host (`agent-team`), model-facing tools (`tool-agent-team`), and Client (`client-agent-team`).
- The Client source had one relative import into the Host generated Remote artifact. The public Remote subpath and the Client bundler alias already existed, so the correction is narrow.
- The tool package consumes Host through public package subpaths. Host has no Client or tool implementation import.

## Host shape

- `agent-team/src/index.ts` is the composition root plus Remote adapter and lifecycle orchestration.
- `agent-team/src/ledger.ts` is the durable authority implementation: operation replay/validation, projection application, and domain queries remain co-located.
- Existing coordinator modules own state or a concrete Harness seam. Extracting activation immediately would create a broad dependency bag because activation crosses those owners.
- The only confirmed pure Client forwarder is `TeamSettings.tsx`; its related dead settings field is a separate cleanup candidate.

## Design rule

Prefer a small interface with substantial behavior behind it. Add a directory or seam only when a second adapter, a second caller, or independently owned state makes it real. For the next two releases, write down and mechanically preserve the current seams first; use the next feature to decide whether activation deserves a deeper module.
