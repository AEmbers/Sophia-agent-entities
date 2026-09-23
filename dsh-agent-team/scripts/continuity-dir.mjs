// Single source of truth for which `@wowyuarm/dsh-context-continuity` this
// repository resolves against.
//
// The engine is a separate repository with its own release cadence, published
// as `@wowyuarm/dsh-context-continuity` and declared by this root package both
// as a runtime peer (what a profile install resolves for the bundle) and as a
// devDependency (what a clean checkout installs so the gate can run). Two
// shapes are therefore legitimate, and the difference matters to the link step:
//
//   1. DSH_CONTEXT_CONTINUITY_DIR — an isolated checkout for a release or
//      certification run.
//   2. The daily sibling checkout `../dsh-context-continuity` — development
//      against an engine working tree. It is not a package install, so
//      `link-harness-packages.mjs` links it into node_modules to make the
//      package name resolve to it (`continuityFromSibling` is true).
//   3. The installed package in node_modules — a clean checkout (CI) after
//      `pnpm install`. Nothing to link there: the package manager already put
//      the published, prebuilt engine where the package name resolves.
//
// A resolution that carries no package layout fails fast here, at its cause,
// instead of surfacing later as a far-away `Cannot find module
// '@wowyuarm/dsh-context-continuity'` inside an unrelated test.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CONTINUITY_NAME = 'dsh-context-continuity'

const ENGINE_PACKAGE = '@wowyuarm/dsh-context-continuity'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Name of the sibling engine checkout directory (env override > the default name). */
export const continuityName = process.env.DSH_CONTEXT_CONTINUITY_DIR?.trim() || DEFAULT_CONTINUITY_NAME

/** Whether one directory is an engine package layout (manifest present). */
function isEngineDirectory(candidate) {
  return existsSync(join(candidate, 'package.json'))
}

const explicitDir = process.env.DSH_CONTEXT_CONTINUITY_DIR?.trim()
const siblingRoot = resolve(projectRoot, '..', DEFAULT_CONTINUITY_NAME)
const installedRoot = join(projectRoot, 'node_modules', ...ENGINE_PACKAGE.split('/'))

/** Fail fast on the resolution cause, never later on a missing module. */
function unresolvable() {
  const siblings = readdirSync(join(projectRoot, '..'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()
      && entry.name !== 'dsh-agent-team'
      && !entry.name.startsWith('.'))
    .map(entry => entry.name)
  throw new Error(
    'The context-continuity engine could not be resolved. Looked for, in order:'
    + ` DSH_CONTEXT_CONTINUITY_DIR${explicitDir === undefined ? ' (unset)' : ` (set to '${explicitDir}')`},`
    + ` the sibling checkout '../${DEFAULT_CONTINUITY_NAME}', and the installed package`
    + ` 'node_modules/${ENGINE_PACKAGE}'.`
    + ' Fix by installing it (pnpm install brings in the published engine),'
    + ' or by keeping an engine checkout as a sibling and building it there (npm run build).'
    + ` Sibling directories that DO exist: ${siblings.length > 0 ? siblings.join(', ') : '(none)'}.`,
  )
}

/** Which engine directory this run uses, and whether the link step must provide it. */
function resolveContinuity() {
  if (explicitDir !== undefined) {
    const explicit = resolve(explicitDir)
    if (!isEngineDirectory(explicit)) unresolvable()
    return { dir: explicit, fromSibling: explicit !== installedRoot }
  }
  if (existsSync(siblingRoot) && statSync(siblingRoot).isDirectory() && isEngineDirectory(siblingRoot)) {
    return { dir: siblingRoot, fromSibling: true }
  }
  if (isEngineDirectory(installedRoot)) return { dir: installedRoot, fromSibling: false }
  return unresolvable()
}

const resolved = resolveContinuity()

/** Absolute path of the engine package every consumer resolves against. */
export const continuityDir = resolved.dir

/**
 * Whether the resolved engine is a checkout the link step must provide. False
 * means the package manager already installed it under the package name, where
 * a link would point the entry at itself.
 */
export const continuityFromSibling = resolved.fromSibling

/** The built package entry the resolved engine exposes. */
export const continuityEntry = join(continuityDir, 'lib', 'index.js')
