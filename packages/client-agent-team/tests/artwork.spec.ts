import { describe, expect, it } from 'vitest'
import {
  ACTION_ART,
  ART_BASE,
  LEAD_ART,
  OC_ART_BASE,
  memberArtUrl,
} from '../src/client/dag/artwork.ts'

/** The twenty posts, by the slug that ships, the post title, and the Chinese name. */
const POSTS: ReadonlyArray<readonly [string, string, string]> = [
  ['lead-ceo', 'ceo', '钦天监监正'],
  ['product-director', 'product director', '产品总监'],
  ['program-director', 'program director', '项目总监'],
  ['resource-admin', 'resource admin', '典籍掌事'],
  ['risk-compliance', 'risk', '星禁掌察'],
  ['requirement-analyst', 'requirement analyst', '观象访事'],
  ['product-manager', 'product manager', '星图主事'],
  ['ux-designer', 'ux', '象绘主事'],
  ['ui-designer', 'ui', '星绘主事'],
  ['client-success', 'client success', '传报主事'],
  ['architect', 'architect', '灵台郎'],
  ['backend-engineer', 'backend', '历算主事'],
  ['frontend-engineer', 'frontend', '星仪主事'],
  ['data-engineer', 'data engineer', '数象主事'],
  ['algorithm-engineer', 'algorithm', '推步主事'],
  ['business-qa', 'business qa', '星验主事'],
  ['test-engineer', 'test engineer', '星机校验'],
  ['ops-engineer', 'ops', '天象值守'],
  ['code-reviewer', 'code reviewer', '星文审校'],
  ['docs-writer', 'docs writer', '录典主事'],
]

/** Plainer role words that must land on a post rather than the whale buckets. */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['team lead', 'lead-ceo'],
  ['product owner', 'product-manager'],
  ['project coordinator', 'program-director'],
  ['security engineer', 'risk-compliance'],
  ['researcher', 'requirement-analyst'],
  ['designer', 'ui-designer'],
  ['customer support', 'client-success'],
  ['developer', 'backend-engineer'],
  ['data scientist', 'data-engineer'],
  ['qa', 'test-engineer'],
  ['tester', 'test-engineer'],
  ['verifier', 'test-engineer'],
  ['reviewer', 'code-reviewer'],
  ['devops', 'ops-engineer'],
  ['technical writer', 'docs-writer'],
]

describe('memberArtUrl', () => {
  it('resolves every post title to its own OC portrait', () => {
    for (const [slug, title] of POSTS) {
      expect(memberArtUrl('', title), title).toBe(`${OC_ART_BASE}${slug}.webp`)
    }
  })

  it('resolves every Chinese post name to its own OC portrait', () => {
    for (const [slug, , chinese] of POSTS) {
      expect(memberArtUrl('', chinese), chinese).toBe(`${OC_ART_BASE}${slug}.webp`)
    }
  })

  it('matches a post through the member name as well as the role', () => {
    expect(memberArtUrl('backend-engineer', 'engineer')).toBe(`${OC_ART_BASE}backend-engineer.webp`)
    expect(memberArtUrl('smoke-verifier', 'verifier')).toBe(`${OC_ART_BASE}test-engineer.webp`)
    expect(memberArtUrl('smoke-reviewer', 'reviewer')).toBe(`${OC_ART_BASE}code-reviewer.webp`)
  })

  it('prefers the post title when the title and a plain word both match', () => {
    // "business qa" is its own post; "qa" alone is the test-engineer post.
    expect(memberArtUrl('', 'business qa')).toBe(`${OC_ART_BASE}business-qa.webp`)
    expect(memberArtUrl('', 'qa')).toBe(`${OC_ART_BASE}test-engineer.webp`)
    // "code reviewer" is a post; "reviewer" is the same post through the alias.
    expect(memberArtUrl('', 'code reviewer')).toBe(`${OC_ART_BASE}code-reviewer.webp`)
    expect(memberArtUrl('', 'reviewer')).toBe(`${OC_ART_BASE}code-reviewer.webp`)
  })

  it('keeps the OC portraits for the plainer role words', () => {
    for (const [role, slug] of ALIASES) {
      expect(memberArtUrl('', role), role).toBe(`${OC_ART_BASE}${slug}.webp`)
    }
  })

  it('falls back to a whale bucket only when no post applies', () => {
    // "engineer" alone names no post, so the whale bucket still catches it.
    expect(memberArtUrl('', 'engineer')).toBe(`${ART_BASE}member-engineer-v2.png`)
    expect(memberArtUrl('', 'watcher')).toBe(`${ART_BASE}member-engineer-v2.png`)
    expect(memberArtUrl('smoke-tester', '')).toBe(`${OC_ART_BASE}test-engineer.webp`)
  })

  it('returns null when nothing matches, so the caller can draw an initial', () => {
    expect(memberArtUrl('wizard', 'wizardry')).toBeNull()
    expect(memberArtUrl('', '')).toBeNull()
  })

  it('exports the captain and activity artwork the panels load', () => {
    expect(LEAD_ART).toBe(`${OC_ART_BASE}lead-ceo.webp`)
    expect(ACTION_ART).toEqual({
      working: `${ART_BASE}action-working-v2.png`,
      idle: `${ART_BASE}action-sleeping-v2.png`,
      unknown: `${ART_BASE}action-thinking-v2.png`,
    })
  })
})
