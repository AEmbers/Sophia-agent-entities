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
 * anything under `packages/`. The comparison runs against HEAD, so it is about
 * the committed artifact, not about what happens to be staged.
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

const moved = [
  ...paths(git('diff', '--name-only', 'HEAD', '--', 'packages')).map(path => `moved     ${path}`),
  ...paths(git('ls-files', '--others', '--exclude-standard', '--', 'packages')).map(path => `untracked ${path}`),
]

if (moved.length > 0) {
  console.error('check-bundle FAILED: the build no longer matches the shipped artifacts under packages/.')
  for (const entry of moved) console.error(`  ${entry}`)
  console.error(`
A moved shipped file means src/ and the committed lib/ disagree: a source install
would hand out bundles older than the source next to them. Rebuild and commit the
artifacts together with the source change that moved them:

  npm run build
  git add packages
`)
  process.exit(1)
}

console.log('check-bundle OK: the build matches the committed packages artifacts')
