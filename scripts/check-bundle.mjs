/**
 * Build-freshness check for the artifacts this repository ships from git.
 *
 * `packages/*\/lib` is committed on purpose. A DSH install from a GitHub address
 * clones this branch and packs the root `files` allowlist without running any
 * build step, so the bundles have to live in the tree; a `prepare` script cannot
 * replace them, because this build needs the adjacent Harness checkout. That
 * makes staleness the one failure mode such an install cannot show: the tree
 * would hand out bundles that no longer match `src/`.
 *
 * Run it immediately after `npm run build` — CI does exactly that on both lanes,
 * before typecheck — and it fails when the build moved, deleted, or added
 * anything under `packages/*\/lib`, the emitted bundle directories. The
 * comparison runs against HEAD, so it is about the committed artifact, not about
 * what happens to be staged, and it is scoped to those directories so an
 * ordinary edit to a package's `src/` or `tests/` stays green.
 *
 * Line endings are deliberately not part of the contract: `core.autocrlf` makes
 * git compare normalized text, so a Windows checkout that rebuilds the same bytes
 * as a Linux one stays green.
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  } catch (error) {
    throw new Error(`check-bundle needs a git work tree with a HEAD commit: ${error.message}`)
  }
}

/** Split one git path listing into a list, dropping the blank tail. */
const paths = (listing) => listing.split('\n').map(line => line.trim()).filter(Boolean)

// The contract is about the built artifacts, and the pathspec has to say so.
// Scoping this to `packages` would red the gate on any commit that edits a
// package's own src/ or tests/ — work that is expected to change the tree while
// the artifacts it will eventually move are still being written. Only the
// emitted bundle directories are the thing a Git-address install hands out
// without building, so only those are compared.
//
// The trailing `/*` is load-bearing. A git pathspec names the entries that are
// in the index, and `packages/*/lib` is a directory: it matches no file, so
// `git diff --name-only HEAD -- packages/*/lib` prints nothing and this gate
// passes no matter what the build did. `packages/*/lib/**` is not a substitute
// either — without `:(glob)` a bare `**` is an ordinary `*` here, and the
// pattern still bottoms out on a directory. `packages/*/lib/*` matches every
// emitted file at any depth, which is the contract this check states.
const ARTIFACTS = ['packages/*/lib/*']

const moved = [
  ...paths(git('diff', '--name-only', 'HEAD', '--', ...ARTIFACTS)).map(path => `moved     ${path}`),
  ...paths(git('ls-files', '--others', '--exclude-standard', '--', ...ARTIFACTS)).map(path => `untracked ${path}`),
]

/**
 * The first changed text hunk in one artifact, as a few printable lines.
 *
 * "client.js moved" says a rebuild disagrees with the commit but not how, and
 * those two causes need opposite fixes: a genuine source change wants the
 * artifacts recommitted, while a build that leaks an absolute path or a random
 * temporary name is not reproducible at all and would otherwise be recommitted
 * forever. Showing the first divergence separates them at the point of failure,
 * where the runner is the only place that can see it.
 */
const firstDiff = (path) => {
  try {
    const text = git('diff', '-a', '-U0', 'HEAD', '--', path)
    const hunk = text.split('\n').filter(line => line.startsWith('@@') || line.startsWith('+') || line.startsWith('-'))
      .filter(line => !line.startsWith('+++') && !line.startsWith('---'))
    if (hunk.length === 0) return []
    return hunk.slice(0, 6).map(line => `      ${line.slice(0, 200)}`)
  } catch {
    return []
  }
}

if (moved.length > 0) {
  console.error('check-bundle FAILED: the build no longer matches the shipped artifacts under packages/.')
  for (const entry of moved) console.error(`  ${entry}`)
  for (const path of moved.map(entry => entry.split(/\s+/)[1]).slice(0, 3)) {
    const hunk = firstDiff(path)
    if (hunk.length > 0) {
      console.error(`\n  first difference in ${path}:`)
      for (const line of hunk) console.error(line)
    }
  }
  console.error(`
A moved shipped file means src/ and the committed lib/ disagree: a source install
would hand out bundles older than the source next to them. Rebuild and commit the
artifacts together with the source change that moved them:

  npm run build
  git add packages

If the rebuild cannot reproduce these files byte for byte, the build itself is
not deterministic — read the diff (git diff -a -- packages) before blaming the
commit, and check what generated the file:

  scripts/generate-typert.mjs   channel .ts type surfacing
  scripts/build-client.mjs      the browser bundle and its sourcemap,
                                through packages/client-agent-team/tsdown.config.ts
`)
  process.exit(1)
}

console.log('check-bundle OK: the build matches the committed packages artifacts')
