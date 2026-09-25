// Generic launcher for an archived measurement recipe under recipes/: substitutes
// the __…__ placeholders, copies the recipe into the Harness checkout's vitest
// roots, runs it there, then deletes the copy.
// Recipe output (screenshots, JSON probes) lands in the Git-ignored
// .scratch/local/claim-panel-ux/<label>/ and never inside this archive.
// Usage: node .scratch/archive/2026-09/claim-panel-ux/recipes/run-local.mjs <file.e2e.ts> <label>
// Prerequisites are in this directory's README.md (adjacent harness checkout,
// installed deps, built packages).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { harnessDir } from '../../../../../scripts/harness-dir.mjs'

const file = process.argv[2]
const label = process.argv[3] ?? 'run'
if (file === undefined) throw new Error('usage: node run-local.mjs <file.e2e.ts> <label>')
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../../..')
const out = join(root, '.scratch/local/claim-panel-ux', label)
const harness = harnessDir
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
const temporary = await mkdtemp(join(tmpdir(), 'dsh-claim-local-'))
const overlay = join(temporary, 'overlay.yml')
const home = join(temporary, 'home')
const basename = `__external-claim-${label.replace(/[^a-z0-9-]/gi, '')}.e2e.ts`
const test = join(harness, 'apps/web/tests', basename)

const quote = value => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
const overlayText = await readFile(join(root, 'cordis.patch.yml'), 'utf8')

const run = (command, args, cwd) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)))
})

try {
  const rendered = (await readFile(join(here, file), 'utf8'))
    .replaceAll('__TEAM_ROOT__', quote(root))
    .replaceAll('__OVERLAY__', quote(overlay))
    .replaceAll('__HOME__', quote(home))
    .replaceAll('__CHROME__', quote(chrome))
    .replaceAll('__LABEL__', quote(label))
    .replaceAll('__OUT__', quote(out))
  await mkdir(out, { recursive: true })
  await writeFile(overlay, overlayText)
  await writeFile(test, rendered)
  await run('corepack', ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.web.config.ts', `apps/web/tests/${basename}`, '--reporter=verbose'], harness)
} finally {
  await rm(test, { force: true })
  await rm(temporary, { recursive: true, force: true })
}
