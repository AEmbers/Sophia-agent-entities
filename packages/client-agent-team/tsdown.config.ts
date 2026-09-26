import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// One pointer for every consumer: scripts/harness-dir.mjs owns the checkout
// (the certification env override, the marker sync-paths wrote, then the daily
// sibling default), so a certification run can never build the client against
// a different checkout than the type and test layer. Both imports stay
// dynamic: a static template-literal module path breaks tsdown's config loader.
const { harnessDir } = await import('../../scripts/harness-dir.mjs')
const { clientBundle } = await import(pathToFileURL(resolve(harnessDir, 'packages/client/tsdown.client.ts')).href)

const bundle = clientBundle('dsh-sophia-entities', [
  'lib/types/index.js',
])

// The Team Remote resolves through its own plugin rather than `resolve.alias`.
// tsdown reads the client's tsconfig `paths`, whose `/remote` entry points at
// the generated `.d.ts` for the type facets, and that mapping is what resolves
// this specifier; the generated runtime artifact is the one the package's own
// `./remote` export declares as `default`. The plugin therefore pins the
// specifier explicitly instead of leaving it to a mapping that targets types.
//
// The target is anchored to this config file, never to the process cwd. The
// earlier `resolve('../../../packages/...')` form was relative to whatever
// directory the config ran from — tsdown runs from `packages/client-agent-team`,
// one level deeper than the repository root the string was written for, so it
// silently pointed outside the repository.
const teamRemoteTarget = resolve(import.meta.dirname, '../agent-team/lib/typert.remote-client.js')
const teamRemote = {
  name: 'dsh-agent-team-remote-entrypoint',
  resolveId(source: string) {
    return source === 'dsh-sophia-entities/remote' ? teamRemoteTarget : null
  },
}

// The Harness preset names its CSS Modules virtual modules after the absolute
// stylesheet path (`\0dsh-css:<abs>.mjs`, see the harness's own
// packages/client/tsdown.client.ts), and Rolldown prints that id in a
// `//#region` comment wherever the module lands in the bundle. Those comments
// are the only place in the emitted artifact that records where the build ran:
// the sourcemap already uses relative sources, and everything else is either
// the plugin's own text or the literal stylesheet. Left alone they make
// `lib/client.js` a function of the builder's directory, so the committed
// bundle can only be reproduced from one checkout path — which is exactly what
// the CI freshness gate compares.
//
// Rewrite the repository root back to a relative prefix so the same source
// builds the same bytes anywhere. Scoped to the client bundle and to this one
// comment shape; a path-bearing comment that matches nothing is left as is
// rather than guessed at.
const REGION_ABSOLUTE = /(\/\/#region \\0(?:dsh-css|dsh-global-css|dsh-inline-css):)([^\r\n]*?)(\.mjs)/g
const normalizeRegions = (root: string) => ({
  name: 'dsh-stable-region-paths',
  renderChunk(code: string) {
    const needle = root.endsWith('/') ? root : `${root}/`
    const rewritten = code.replace(REGION_ABSOLUTE, (match, head: string, file: string, tail: string) => {
      const folded = file.split('\\').join('/')
      const at = folded.indexOf(needle.split('\\').join('/'))
      if (at < 0) return match
      return `${head}${folded.slice(at + needle.length)}${tail}`
    })
    return rewritten === code ? null : { code: rewritten, map: null }
  },
})

export default async (options: Parameters<typeof bundle>[0]) => {
  const configs = await bundle(options)
  return configs.map(entry => ({
    ...entry,
    plugins: [...(entry.plugins ?? []), teamRemote, normalizeRegions(resolve(import.meta.dirname, '../..'))],
  }))
}
