// Regenerates the resolution facades from the sibling deepseek-harness checkout.
// Harness imports resolve against its source or declarations; this external bundle's
// public subpaths resolve to their maintained implementation directories.
import { readFileSync, writeFileSync } from 'node:fs'
import { harnessName } from './harness-dir.mjs'

// scripts/harness-dir.mjs owns the checkout pointer (env override for
// certification runs, daily sibling default, fail-fast on a missing dir).
const HARNESS_NAME = harnessName
const HARNESS = new URL(`../../${HARNESS_NAME}/`, import.meta.url)
const raw = readFileSync(new URL('tsconfig.base.json', HARNESS), 'utf8')
const cleaned = raw
  .split('\n')
  .filter(line => !/^\s*\/\//.test(line))
  .join('\n')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
const base = JSON.parse(cleaned)

const own = {
  'dsh-sophia-entities/host': ['./packages/agent-team/src/index.ts'],
  'dsh-sophia-entities/invariant': ['./packages/agent-team/src/invariant.ts'],
  'dsh-sophia-entities/types': ['./packages/agent-team/src/types.ts'],
  'dsh-sophia-entities/typert': ['./packages/agent-team/lib/typert.host.d.ts'],
  'dsh-sophia-entities/remote': ['./packages/agent-team/lib/typert.remote-client.js'],
  'dsh-sophia-entities/sqlite-backend': ['./packages/agent-team/src/vendor/storage-sqlite/index.ts'],
  'dsh-sophia-entities/member-context': ['./packages/agent-team/src/member-context.ts'],
  'dsh-sophia-entities/mentions': ['./packages/agent-team/src/mentions.ts'],
  'dsh-sophia-entities/member-skills': ['./packages/agent-team/src/member-skills.ts'],
  'dsh-sophia-entities/tools': ['./packages/tool-agent-team/src/index.ts'],
  'dsh-sophia-entities/client': ['./packages/client-agent-team/src/client/index.ts'],
  // Contract seam: orchestration/src/index.ts re-exports strict-incompatible
  // store/router/facade/tools/routes (that package deliberately relaxes
  // exactOptionalPropertyTypes), so consumers resolve to its dependency-free
  // types.ts — the full ApprovalRequest/TeamBackend contract surface.
  'dsh-sophia-entities/orchestration': ['./packages/orchestration/src/types.ts'],
  // Value subpaths for the approval glue (packages/dag-team/src/sophia-approval.ts):
  // the facade/tools wiring imports orchestration RUNTIME values, which the
  // types-only contract seam above cannot provide; /types mirrors the seam so
  // consumers may address the contract surface by module name.
  'dsh-sophia-entities/orchestration/facade': ['./packages/orchestration/src/facade.ts'],
  'dsh-sophia-entities/orchestration/tools': ['./packages/orchestration/src/tools.ts'],
  'dsh-sophia-entities/orchestration/types': ['./packages/orchestration/src/types.ts'],
  'dsh-sophia-entities/orchestration/routes': ['./packages/orchestration/src/routes.ts'],
  'dsh-sophia-entities/orchestration/notifier': ['./packages/orchestration/src/notifier.ts'],
  // agent-team's persistent TeamBackend for the approval plane; the host
  // surface (dsh-sophia-entities/host) does not export it, so the glue reaches
  // it through its own declared subpath.
  'dsh-sophia-entities/persistent-backend': ['./packages/agent-team/src/sophia-persistent-backend.ts'],
}

const ownTypes = {
  ...own,
  'dsh-sophia-entities/remote': ['./packages/agent-team/lib/typert.remote-client.d.ts'],
}

const harnessSrc = {
  '@deepseek-ai/dsh-storage-sqlite': [`../${HARNESS_NAME}/packages/storage/storage-sqlite/src/index.ts`],
  '@deepseek-ai/dsh-skill': [`../${HARNESS_NAME}/packages/skill/skill/src/index.ts`],
  '@deepseek-ai/dsh-skill-filesystem': [`../${HARNESS_NAME}/packages/skill/skill-filesystem/src/index.ts`],
}
for (const [key, value] of Object.entries(base.compilerOptions.paths)) {
  harnessSrc[key] = (Array.isArray(value) ? value : [value])
    .map(path => path.replace(/^\.\//, `../${HARNESS_NAME}/`))
}
// dsh-client-locale is the one client package whose source dictionaries are
// reachable only through its verified "./src/*" export (the test harness
// loads the zh/en tables from source). The bare-name mapping above is
// exact-match only, so deep imports need a wildcard mirroring the export.
harnessSrc['@deepseek-ai/dsh-client-locale/src/*'] = [`../${HARNESS_NAME}/packages/client/locale/src/*`]
// The v3→v4 migration test reads its source rewrite through this package's
// same verified "./src/*" export, so its wildcard mirrors that export too.
harnessSrc['@deepseek-ai/dsh-session-format-v3-to-v4/src/*'] = [`../${HARNESS_NAME}/packages/session/session-format-v3-to-v4/src/*`]

const toTypes = path => path
  .replace(/\/src\/(.+)\.ts$/, '/lib/types/$1.d.ts')
  .replace(/\/src\/(.+)$/, '/lib/types/$1')
  .replace(/\/src$/, '/lib/types')

const harnessTypes = Object.fromEntries(
  Object.entries(harnessSrc).map(([key, value]) => [key, value.map(toTypes)]),
)

const buildOwn = {
  'dsh-sophia-entities/host': ['./packages/agent-team/lib/types/index.d.ts'],
  'dsh-sophia-entities/invariant': ['./packages/agent-team/lib/types/invariant.d.ts'],
  'dsh-sophia-entities/types': ['./packages/agent-team/lib/types/types.d.ts'],
  'dsh-sophia-entities/typert': ['./packages/agent-team/lib/typert.host.d.ts'],
  'dsh-sophia-entities/remote': ['./packages/agent-team/lib/typert.remote-client.d.ts'],
  'dsh-sophia-entities/sqlite-backend': ['./packages/agent-team/lib/types/vendor/storage-sqlite/index.d.ts'],
  'dsh-sophia-entities/member-context': ['./packages/agent-team/lib/types/member-context.d.ts'],
  'dsh-sophia-entities/mentions': ['./packages/agent-team/lib/types/mentions.d.ts'],
  'dsh-sophia-entities/member-skills': ['./packages/agent-team/lib/types/member-skills.d.ts'],
  'dsh-sophia-entities/tools': ['./packages/tool-agent-team/lib/types/index.d.ts'],
  'dsh-sophia-entities/client': ['./packages/client-agent-team/lib/types/client/index.d.ts'],
  'dsh-sophia-entities/orchestration': ['./packages/orchestration/lib/types/index.d.ts'],
  'dsh-sophia-entities/orchestration/facade': ['./packages/orchestration/lib/types/facade.d.ts'],
  'dsh-sophia-entities/orchestration/tools': ['./packages/orchestration/lib/types/tools.d.ts'],
  'dsh-sophia-entities/orchestration/types': ['./packages/orchestration/lib/types/types.d.ts'],
  'dsh-sophia-entities/orchestration/routes': ['./packages/orchestration/lib/types/routes.d.ts'],
  'dsh-sophia-entities/orchestration/notifier': ['./packages/orchestration/lib/types/notifier.d.ts'],
  'dsh-sophia-entities/persistent-backend': ['./packages/agent-team/lib/types/sophia-persistent-backend.d.ts'],
}

const shared = {
  target: 'es2024', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
  esModuleInterop: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
  verbatimModuleSyntax: false, strict: true, noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true, noImplicitOverride: true, noFallthroughCasesInSwitch: true,
  types: ['node'], noEmit: true,
}

const header = text => `// GENERATED by scripts/sync-paths.mjs against ../${HARNESS_NAME} - edit that script, not this file.\n${text}`

// The marker lets scripts/harness-dir.mjs follow the SAME checkout after a
// cert-run generation, so tests keep matching the facades without a sticky
// env var. Regenerating against another checkout (or the daily default)
// overwrites it.
writeFileSync(new URL('../.generated-harness', import.meta.url), `${HARNESS_NAME}\n`)

writeFileSync(new URL('../tsconfig.json', import.meta.url), `${JSON.stringify({
  compilerOptions: { ...shared, paths: { ...own, ...harnessSrc } },
}, null, 2)}\n`.replace(/^/, header('// Runtime facade for the external bundle and sibling Harness source.\n')))

writeFileSync(new URL('../tsconfig.types.json', import.meta.url), `${JSON.stringify({
  compilerOptions: { ...shared, paths: { ...ownTypes, ...harnessTypes } },
}, null, 2)}\n`.replace(/^/, header('// Typecheck facade for the external bundle and sibling Harness declarations.\n')))

writeFileSync(new URL('../tsconfig.build-deps.json', import.meta.url), `${JSON.stringify({
  compilerOptions: { ...shared, paths: { ...buildOwn, ...harnessTypes } },
}, null, 2)}\n`.replace(/^/, header('// Build facade: own cross-surface imports resolve to emitted declarations.\n')))

console.log(`wrote tsconfig.json (${Object.keys(harnessSrc).length} Harness mappings), tsconfig.types.json, and tsconfig.build-deps.json`)
