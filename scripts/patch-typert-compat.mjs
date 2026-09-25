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
// is still 0.1.5-rc.2. Its typert loader / registry validates the emitted
// manifest with duck typing (NOT `instanceof`, so a duplicated zod instance is
// irrelevant — the host runs zod 4.6.2 and this plugin 4.4.3). It requires the
// codec to carry a real zod object:
//
//   typeof codec.schema === 'object' && '_zod' in codec.schema
//                                     && typeof codec.schema.parse === 'function'
//
// A 0.1.7-shaped manifest therefore fails with either:
//   typert-loader: <pkg> invocation "<ns>/<method>" parameter codec is not
//   backed by a zod v4 schema
//   typert: <pkg>#<ns>/<method> result strict codec has no parse() method
//
// The fix is two mechanical rewrites on the emitted artifact:
//   1. `create:`          -> `schema:`
//   2. `schema: <thunk>`  -> `schema: <thunk>()`   (force the lazy getter)
//
// Rewrite 2 deliberately does NOT require a trailing comma. The host-side and
// remote-client manifests are pretty-printed (`schema: x,\n`), but the browser
// bundle is minified and `schema` is the LAST field of each codec object
// (`schema: x\n}`). Requiring a comma silently skipped all 66 client-side
// codecs — the host half loaded fine while the browser half reported
// "Failed to load plugins". A lookahead on `,` or `}` covers both layouts.
//
// Both rewrites are idempotent: a materialised value ends in `()` and so
// matches neither pattern again.
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

/** Field rename emitted by the 0.1.7 generator. */
const CODEC_FIELD = /\bcreate:/g

/**
 * A codec whose value is still an un-called thunk, in either the pretty-printed
 * (`schema: x,`) or minified last-field (`schema: x}`) layout.
 */
const CODEC_THUNK = /(schema:\s*)([A-Za-z0-9_$][A-Za-z0-9_$]*)(?=\s*[,}])/g

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
    // Only typert manifests carry these literals; skip everything else fast.
    // `String.match` with /g ignores lastIndex, so this is safe to reuse.
    const hasField = before.includes('create:')
    const hasThunk = (before.match(CODEC_THUNK) ?? []).length > 0
    if (!hasField && !hasThunk) continue

    const renames = (before.match(CODEC_FIELD) ?? []).length
    let after = before.replace(CODEC_FIELD, 'schema:')
    const thunks = (after.match(CODEC_THUNK) ?? []).length
    after = after.replace(CODEC_THUNK, '$1$2()')

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
