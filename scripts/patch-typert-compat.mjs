// Harness 0.1.5 <-> 0.1.7 host-compatibility shim.
//
// WHY THIS EXISTS
// ---------------
// This project is built against the 0.1.7 harness checkout
// (`../deepseek-harness`, the version the base plugin's peerDependencies ask
// for), but the local DSH host is still 0.1.5-rc.2. Three 0.1.7 changes break a
// 0.1.7-built artifact on that older host — and every one of them fails
// SILENTLY at first glance:
//
// 1. typert codec shape
//      0.1.5   codec: { mode, typeSymbol, schema: <zod object> }
//      0.1.7   codec: { mode, typeSymbol, create: <lazy thunk> }
//    The host's typert loader/registry validates with duck typing — NOT
//    `instanceof`, so a duplicated zod instance is irrelevant (host runs zod
//    4.6.2, this plugin 4.4.3):
//      typeof codec.schema === 'object' && '_zod' in codec.schema
//                                        && typeof codec.schema.parse === 'function'
//    A 0.1.7-shaped manifest dies with either
//      typert-loader: <pkg> invocation "<ns>/<method>" parameter codec is not
//      backed by a zod v4 schema
//    or
//      typert: <pkg>#<ns>/<method> result strict codec has no parse() method
//
// 2. icon naming
//      0.1.5   IconAgentPresetOutline
//      0.1.7   IconAgentPresetOutlineRegular
//    The plugin asks `@deepseek-ai/dsh-client-ui-primitives` for the suffixed
//    names; the 0.1.5 platform seed exports only the unsuffixed ones. Every
//    icon therefore resolves to `undefined`, React throws while rendering, and
//    the plugin's entire UI silently never appears — while the Node half and
//    the module loading pipeline both report success.
//
// 3. minified vs pretty-printed layouts
//    The host / remote-client manifests are pretty-printed (`schema: x,\n`),
//    but the browser bundle is minified and `schema` is the LAST field of each
//    codec object (`schema: x\n}`). A rewrite that insists on a trailing comma
//    silently skips all 66 client-side codecs.
//
// All three rewrites are idempotent.
//
// ⚠️ THIS IS A BUILD-ARTIFACT PATCH, NOT A SOURCE FIX.
// It exists only to bridge a local host older than the build checkout. Delete
// this script and its invocation in package.json's `build` script once the DSH
// host is upgraded to >= 0.1.7-rc.1.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LIB_ROOTS = [
  'packages/agent-team/lib',
  'packages/tool-agent-team/lib',
  'packages/client-agent-team/lib',
]

/** Codec field rename emitted by the 0.1.7 generator. */
const CODEC_FIELD = /\bcreate:/g

/**
 * A codec whose value is still an un-called thunk, in either the pretty-printed
 * (`schema: x,`) or minified last-field (`schema: x}`) layout.
 */
const CODEC_THUNK = /(schema:\s*)([A-Za-z0-9_$][A-Za-z0-9_$]*)(?=\s*[,}])/g

/** Icon size suffix introduced in 0.1.7. */
const ICON_OUTLINE_SUFFIX = /(Icon[A-Za-z]+)Outline(?:Regular|Medium)\b/g

/** The one icon that carries no `Outline` segment before its size suffix. */
const ICON_FOLDER_OPEN = /IconFolderOpenRegular\b/g

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
let icons = 0

for (const root of LIB_ROOTS) {
  for (const file of walk(root)) {
    const before = readFileSync(file, 'utf8')

    // `String.match` with /g ignores lastIndex, so these are safe to reuse.
    const hasField = before.includes('create:')
    const hasThunk = (before.match(CODEC_THUNK) ?? []).length > 0
    const hasIcon = (before.match(ICON_OUTLINE_SUFFIX) ?? []).length > 0
      || (before.match(ICON_FOLDER_OPEN) ?? []).length > 0
    if (!hasField && !hasThunk && !hasIcon) continue

    const renames = (before.match(CODEC_FIELD) ?? []).length
    let after = before.replace(CODEC_FIELD, 'schema:')

    const thunks = (after.match(CODEC_THUNK) ?? []).length
    after = after.replace(CODEC_THUNK, '$1$2()')

    const iconHits = (after.match(ICON_OUTLINE_SUFFIX) ?? []).length
      + (after.match(ICON_FOLDER_OPEN) ?? []).length
    after = after
      .replace(ICON_OUTLINE_SUFFIX, '$1Outline')
      .replace(ICON_FOLDER_OPEN, 'IconFolderOpenOutline')

    if (after === before) continue
    writeFileSync(file, after)
    patchedFiles += 1
    renamed += renames
    materialised += thunks
    icons += iconHits
    console.log(
      `  patched ${file}  (rename ${String(renames)}, `
      + `materialise ${String(thunks)}, icons ${String(iconHits)})`,
    )
  }
}

console.log(
  `host-compat: ${String(patchedFiles)} file(s) patched, `
  + `${String(renamed)} codec rename(s), ${String(materialised)} thunk materialisation(s), `
  + `${String(icons)} icon rename(s)`,
)
