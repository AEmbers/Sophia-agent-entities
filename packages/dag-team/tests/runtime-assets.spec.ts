/**
 * Fence for the two artwork directories the Host serves out of the bundle.
 *
 * Both ship verbatim, so a file with no consumer is dead weight in every
 * install, and a file the client asks for but that does not ship renders as a
 * broken image (the shipped-artifact check in scripts/check-artifact.mjs covers
 * the second direction; this spec covers the first).
 *
 * The whale set is deliberately small: the OC portraits carry the roster, so
 * the mascot art survives only as the eight fallback buckets `memberArtUrl`
 * uses for a role that maps to no post, plus the three activity states the
 * panel draws. Adding a file here without a consumer fails the first case.
 * @module dsh-sophia-entities/dag-team/runtime-assets
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const assetsDir = fileURLToPath(new URL('../assets/', import.meta.url))
const clientArtwork = fileURLToPath(new URL('../../client-agent-team/src/client/dag/artwork.ts', import.meta.url))

/** The whale images the client still asks the Host for, and nothing else. */
const WHALE_ART: readonly string[] = [
  'member-researcher-v2.png', 'member-engineer-v2.png',
  'member-qa-v2.png', 'member-designer-v2.png',
  'member-security-v2.png', 'member-docs-v2.png',
  'member-data-v2.png', 'member-operator-v2.png',
  'action-working-v2.png', 'action-thinking-v2.png',
  'action-sleeping-v2.png',
]

/** Both routes serve one flat directory of single-segment names. */
function listing(directory: string): string[] {
  return readdirSync(join(assetsDir, directory)).sort()
}

describe('shipped artwork', () => {
  it('ships exactly the whale images the client asks for', () => {
    expect(listing('agent-teams')).toEqual([...WHALE_ART].sort())
  })

  it('names every shipped whale image in the client art tables', () => {
    const source = readFileSync(clientArtwork, 'utf8')
    expect(WHALE_ART.filter((name) => !source.includes(name))).toEqual([])
  })

  it('ships twenty OC portraits, one per post', () => {
    const portraits = listing('sophia-avatars-webp')
    expect(portraits).toHaveLength(20)
    expect(portraits.filter((name) => !name.endsWith('.webp'))).toEqual([])
  })

  it('keeps no artwork without a consumer', () => {
    // ui.png was a design mock and assets/readme held a hero image the
    // repository never referenced; both are gone rather than shipped.
    expect(existsSync(join(assetsDir, 'ui.png'))).toBe(false)
    expect(existsSync(join(assetsDir, 'readme'))).toBe(false)
  })
})
