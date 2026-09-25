// Harness 0.1.5 <-> 0.1.7 typert codec compatibility shim.
//
// WHY THIS EXISTS
// ---------------
// The typert codec shape changed between harness releases:
//
//   $schema  (dsh-v0.1.5-rc.2)   codec: { mode, typeSymbol, schema: <zod object> }
//   $create  (dsh-v0.1.7-rc.2)   codec: { mode, typeSymbol, create: <lazy thunk> }
//
// This project is built against the 0.1.7 checkout (`../deepseek-harness`, the
// version the base plugin's peerDependencies ask for), but the local DSH host
// is still 0.1.5-rc.2. Its `@deepseek-ai/dsh-typert-loader` validates with:
//
//   if (codec.mode !== 'strict') throw ...
//   if (typeof codec.schema !== 'object' || codec.schema === null
//       || !('_zod' in codec.schema)
//       || typeof codec.schema.parse !== 'function') throw ...
//
// so a 0.1.7-shaped manifest fails with:
//   typert-loader: <pkg> invocation "<ns>/<method>" parameter codec is not
//   backed by a zod v4 schema
//
// The fix is two mechanical rewrites on the emitted artifact:
//   1. `create:`            -> `schema:`
//   2. `schema: <thunk>,`   -> `schema: <thunk>(),`   (force the lazy getter)
//
// Both rewrites are idempotent: an already-patched file has `schema:` whose
// value ends in `(),` and therefore matches neither pattern again.
//
// ⚠️ THIS IS A BUILD-ARTIFACT PATCH, NOT A SOURCE FIX.
// It only exists to bridge a local host that is older than the build checkout.
// Once the DSH host is upgraded to >= 0.1.7-rc.1, delete this script and drop
// its invocation from package.json's `build` script.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LIB_ROOTS = [
  'packages/agent-team/lib',
  'packages/tool-agent-team/lib',
  'packages/client-agent-team/lib',
]

/** Depth-first walk yielding every `.js` file under `dir`. */
function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.js')) yield full
  }
}

let patchedFiles = 0
let renamed = 0
let materialised = 0

for (const root of LIB_ROOTS) {
  for (const file of walk(root)) {
    const before = readFileSync(file, 'utf8')
    // Only typert manifests carry the codec literal; skip everything else fast.
    if (!before.includes('create:') && !/(schema: )([A-Za-z0-9_$][A-Za-z0-9_$]*),/.test(before)) continue

    const renames = (before.match(/\bcreate:/g) ?? []).length
    let after = before.replace(/\bcreate:/g, 'schema:')
    const thunks = (after.match(/(schema: )([A-Za-z0-9_$][A-Za-z0-9_$]*),/g) ?? []).length
    after = after.replace(/(schema: )([A-Za-z0-9_$][A-Za-z0-9_$]*),/g, '$1$2(),')

    if (after === before) continue
    writeFileSync(file, after)
    patchedFiles += 1
    renamed += renames
    materialised += thunks
    console.log(`  patched ${file}  (rename ${String(renames)}, materialise ${String(thunks)})`)
  }
}

console.log(
  `typert-compat: ${String(patchedFiles)} file(s) patched, `
  + `${String(renamed)} codec field rename(s), ${String(materialised)} thunk materialisation(s)`,
)
