import { existsSync, realpathSync } from 'node:fs'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { continuityDir } from './continuity-dir.mjs'
import { harnessDir } from './harness-dir.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const harnessRoot = harnessDir
const { WorkspaceAnalyzer } = await import(pathToFileURL(join(harnessRoot, 'packages/typert/generator/src/analyzer.ts')).href)
const { FaceModelEmitter } = await import(pathToFileURL(join(harnessRoot, 'packages/typert/generator/src/emitter.ts')).href)
const { default: ts } = await import(pathToFileURL(join(harnessRoot, 'node_modules/typescript/lib/typescript.js')).href)
const packageRoot = resolve(projectRoot, 'packages/agent-team')
const tempPackage = await mkdtemp(join(harnessRoot, 'packages/external-agent-team-'))
const aggregate = join(tempPackage, 'tsconfig.host.json')
// The temp analysis package sits inside the harness checkout, so the plugin's
// own orchestration package is not resolvable from it: the harness tree has
// no dsh-sophia-entities/orchestration, and the WorkspaceAnalyzer pins every
// analysed program's rootDir to the harness root, so a path alias pointing at
// the plugin repo (outside the harness) would trip TS6059. Land a copy of the
// zero-import contract module (packages/orchestration/src/types.ts) inside
// the harness instead — under its own temp dir, OUTSIDE the analysed package,
// so checkProject's isWithin(registration.root) filter keeps it out of the
// face model — and alias the subpath to that copy. The plugin repo's own
// sync-paths.mjs maps the same subpath at packages/orchestration/src/types.ts
// for plugin-internal typechecks; this copy must stay in sync with that file.
const contractDir = await mkdtemp(join(harnessRoot, 'orchestration-types-'))
const baseConfig = ts.readConfigFile(join(harnessRoot, 'tsconfig.base.json'), ts.sys.readFile)
if (baseConfig.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(baseConfig.error.messageText, '\n'))
const basePaths = baseConfig.config?.compilerOptions?.paths ?? {}
const analysisPaths = Object.fromEntries(
  Object.entries(basePaths).map(([key, targets]) => [key, targets.map(target => resolve(harnessRoot, target))]),
)
analysisPaths['dsh-sophia-entities/orchestration'] = [join(contractDir, 'types.ts')]

try {
  await cp(join(packageRoot, 'src'), join(tempPackage, 'src'), { recursive: true })
  const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
  await writeFile(join(tempPackage, 'package.json'), JSON.stringify({
    name: manifest.name,
    type: manifest.type,
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './types': { types: './lib/types/types.d.ts', default: './lib/types/types.js' },
    },
  }))
  await mkdir(join(tempPackage, 'node_modules'), { recursive: true })
  // Resolve zod once through the real node_modules chain and LINK it into the
  // temp analysis package: a symlink on POSIX, a directory junction on Windows,
  // where a real symlink needs a privilege the runner may not have
  // (link-harness-packages.mjs uses junctions for the same reason). Either form
  // leaves zod's real path in this repository's install, OUTSIDE the analysed
  // package, which is what the analyzer's reachable-files walk assumes.
  //
  // A copy is not equivalent, however tempting: zod's declarations then sit
  // under the analysed root, and resolving `index.d.cts`'s own
  // `./v4/classic/external.cjs` inside that copy reaches a declaration file the
  // program never loaded, which the walk queues as undefined and dies on —
  // a TypeError instead of a diagnosable error.
  //
  // The chain is this repository's own root install: the analysis package sits
  // inside the harness checkout, where nothing provides zod, and `zod` is a
  // dependency of the single root manifest. A per-package
  // `packages/agent-team/node_modules` is NOT a resolution path any more — the
  // workspace has one root package, so a clean install never creates it and the
  // stale directory on a long-lived checkout must not be the only reason the
  // build works.
  // LINK one root-install dependency into the temp analysis package: a
  // symlink on POSIX, a directory junction on Windows, where a real symlink
  // needs a privilege the runner may not have (link-harness-packages.mjs uses
  // junctions for the same reason). Either form leaves the package's real path
  // in this repository's install, OUTSIDE the analysed package, which is what
  // the analyzer's reachable-files walk assumes.
  const linkRootDependency = async (name) => {
    const source = join(projectRoot, 'node_modules', name)
    if (!existsSync(source)) {
      throw new Error(
        `Typert analysis resolves the bundle's '${name}' dependency at '${source}', which is not installed.`
        + ' Run `corepack pnpm install` at the repository root (never npm install: it breaks the workspace links).',
      )
    }
    const target = join(tempPackage, 'node_modules', name)
    if (process.platform === 'win32') {
      await symlink(realpathSync(source), target, 'junction')
    } else {
      await symlink(source, target, 'file')
    }
  }
  await linkRootDependency('zod')
  // The Host face's second root-install dependency: the legacy settings
  // document parse rides the same chain, for the same reasons as zod above.
  await linkRootDependency('yaml')
  // The sibling context-continuity engine is the second external package the
  // Host face imports. The temp package sits inside the harness checkout, so
  // only its own manifest and built declarations travel: copying the checkout
  // would drag its node_modules along, and a symlink is the Windows-hostile
  // form the zod comment above already rules out.
  const engineTarget = join(tempPackage, 'node_modules', '@wowyuarm', 'dsh-context-continuity')
  await mkdir(engineTarget, { recursive: true })
  await cp(join(continuityDir, 'package.json'), join(engineTarget, 'package.json'))
  await cp(join(continuityDir, 'lib'), join(engineTarget, 'lib'), { recursive: true })
  await cp(join(projectRoot, 'packages/orchestration/src/types.ts'), join(contractDir, 'types.ts'))
  await writeFile(join(tempPackage, 'tsconfig.json'), JSON.stringify({
    extends: '../../tsconfig.base.json',
    include: ['src'],
    compilerOptions: {
      noEmit: true,
      rootDir: 'src',
      noUnusedLocals: false,
      noUnusedParameters: false,
      // The temp analysis package sits inside the harness checkout, so the
      // plugin's own orchestration package is not resolvable from it. The
      // backend factories import the contract through its declared subpath;
      // map that subpath to the harness-local copy of types.ts (paths values
      // are absolute so they resolve regardless of the temp package's
      // location, and the analyzer pins rootDir to the harness root so the
      // copy must live inside the harness tree, not the plugin repo). The
      // plugin repo's own sync-paths.mjs maps the same subpath at
      // packages/orchestration/src/types.ts (a zero-import contract module);
      // this copy must stay in sync with that file.
      paths: analysisPaths,
    },
    references: [{ path: '../../packages/typert/protocol' }],
  }))
  const harnessHost = ts.readConfigFile(join(harnessRoot, 'tsconfig.host.json'), ts.sys.readFile)
  if (harnessHost.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(harnessHost.error.messageText, '\n'))
  const references = (harnessHost.config.references ?? []).map(reference => ({
    path: resolve(harnessRoot, reference.path),
  }))
  references.push({ path: tempPackage })
  await writeFile(aggregate, JSON.stringify({
    extends: join(harnessRoot, 'tsconfig.base.json'),
    files: [],
    compilerOptions: { noEmit: true },
    references,
  }))

  const workspace = new WorkspaceAnalyzer({
    root: harnessRoot,
    hostConfig: aggregate,
    clientConfig: join(tempPackage, 'tsconfig.client-missing.json'),
    faces: ['host'],
    packages: ['dsh-sophia-entities'],
  }).analyze()
  const face = workspace.faces.find(candidate => candidate.face === 'host')
  if (face === undefined) throw new Error('Typert did not analyze the Agent Team Host face')
  const artifact = new FaceModelEmitter(face).emit('dsh-sophia-entities')
  if (artifact.remote === undefined) throw new Error('Typert did not emit the Agent Team Remote contribution')

  // The analysis package lives in a randomly named directory, and the emitter
  // records that directory in every `sourceLocation`. Rewrite the temp root back
  // to packages/agent-team so the emitted artifacts are byte-stable: a rebuild
  // that moves no source must leave lib/ untouched (the tree ships the bundles,
  // see .gitignore). Both separator spellings are listed because the emitter's
  // paths come from a path.join on whichever platform runs the build, while
  // basename() keeps the name itself separator-correct.
  const tempName = basename(tempPackage)
  const generatedRoots = [tempPackage, `packages/${tempName}`, `packages\\${tempName}`]
  const stable = value => generatedRoots.reduce((text, root) => text.replaceAll(root, 'packages/agent-team'), value)
  // The emitter copies JSDoc and signature text out of the analyzed sources, and
  // a Windows checkout with `core.autocrlf` has CRLF in those files, so the same
  // commit would emit different bytes per platform (the committed artifact is
  // LF). Git normalizes on commit, so the CR survives only inside a string
  // literal, which is why it has to be folded here rather than left to the diff.
  const foldLineEndings = value => value.replaceAll('\r\n', '\n')
  const output = join(packageRoot, 'lib')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'typert.host.js'), foldLineEndings(stable(artifact.js)))
  await writeFile(join(output, 'typert.host.d.ts'), foldLineEndings(artifact.dts))
  await writeFile(join(output, 'typert.remote-client.js'), foldLineEndings(stable(artifact.remote.js)))
  await writeFile(join(output, 'typert.remote-client.d.ts'), foldLineEndings(artifact.remote.dts))
  await writeFile(join(output, 'typert.remote-client.d.ts.map'), foldLineEndings(artifact.remote.dtsMap))
} finally {
  await rm(tempPackage, { recursive: true, force: true })
  await rm(contractDir, { recursive: true, force: true })
}
