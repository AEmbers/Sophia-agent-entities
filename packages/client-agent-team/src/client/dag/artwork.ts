/**
 * Shared artwork lookup for the activity panel and the conversation card:
 * OC (original character) portraits per member role resolve first — by post
 * title, then by a plainer role word — the legacy whale role images act as a
 * fallback bucket, and the captain uses the OC lead.
 * @module dsh-agent-teams/client/artwork
 */

/** Legacy whale artwork route prefix served by the plugin host half. */
export const ART_BASE = '/plugins/dsh-sophia-entities/assets/'

/** OC portrait route prefix (512x512 WebP, flat slug directory). */
export const OC_ART_BASE = '/plugins/dsh-sophia-entities/sophia-assets/'

/** V2 whale role artwork per role keyword (fallback buckets). */
const ROLE_ART: ReadonlyArray<readonly [RegExp, string]> = [
  [/data|analys|metric|performance|数据|分析|指标|性能/, 'member-data-v2.png'],
  [/resear|investig|explor|study|研究|调查|探索|调研/, 'member-researcher-v2.png'],
  // Match compound QA titles (for example "QA Engineer") before the broad
  // engineer bucket, otherwise an eight-role roster repeats the engineer art.
  [/\bqa\b|test|verif|quality|测试|质量|验证/, 'member-qa-v2.png'],
  [/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程/, 'member-engineer-v2.png'],
  [/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍/, 'member-designer-v2.png'],
  [/secur|audit|risk|threat|review|安全|审计|审查|风险/, 'member-security-v2.png'],
  [/docs|writer|product|spec|撰写|文案|写作|文档|规范/, 'member-docs-v2.png'],
  [/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调/, 'member-operator-v2.png'],
]

/**
 * OC (original character) portraits, one per of the 20 member posts. The
 * Chinese post names and the modern English post labels both match, so the
 * roster text resolves deterministically instead of falling through regex
 * buckets. Source of truth for the post -> slug mapping:
 * docs/material-integration.md §4.
 *
 * 钦天监 is the organisation (Agent Teams itself); every name here is a post
 * inside it, the captain's post being 监正. The historical spelling
 * 钦天监监正 stays in the lead pattern as an alias.
 */
const OC_ROLE_ART: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bceo\b|总负责|队长|监正|钦天监监正/, 'lead-ceo.webp'],
  [/\bproduct\s*director\b|产品总监|灵台主事/, 'product-director.webp'],
  [/\bprogram\s*director\b|项目总监|时宪主事/, 'program-director.webp'],
  [/\bresource\s*admin\b|资源|行政|典籍掌事/, 'resource-admin.webp'],
  [/\brisk\b|compliance|风控|合规|星禁掌察/, 'risk-compliance.webp'],
  [/\breq(?:uirement)?\s*analyst\b|需求分析|观象访事/, 'requirement-analyst.webp'],
  [/\bproduct\s*manager\b|产品经理|星图主事/, 'product-manager.webp'],
  [/\bux\b|交互|用户体?验|象绘主事/, 'ux-designer.webp'],
  [/\bui\b|视觉|界面|星绘主事/, 'ui-designer.webp'],
  [/\bclient\s*success\b|客户|对接|传报主事/, 'client-success.webp'],
  [/\barchitect\b|架构|灵台郎/, 'architect.webp'],
  [/\bbackend\b|后端|历算主事/, 'backend-engineer.webp'],
  [/\bfrontend\b|前端|星仪主事/, 'frontend-engineer.webp'],
  [/\bdata\s*engineer\b|数据工程|数象主事/, 'data-engineer.webp'],
  [/\balgorithm\b|算法|推步主事/, 'algorithm-engineer.webp'],
  [/\bbusiness\s*qa\b|业务.?qa|星验主事/, 'business-qa.webp'],
  [/\btest(?:ing)?\s*engineer\b|测试工程师|星机校验/, 'test-engineer.webp'],
  [/\bops\b|运维|值守|天象值守/, 'ops-engineer.webp'],
  [/\bcode\s*review\w*\b|代码评审|审校|星文审校/, 'code-reviewer.webp'],
  [/\bdocs\s*writer\b|文档撰写|录典主事/, 'docs-writer.webp'],
]

/**
 * Ordinary role words that name one of the same twenty posts in plainer English
 * than the post titles do. Checked AFTER the posts, so a post title always wins,
 * and BEFORE the whale buckets, so a member whose role is simply "reviewer" or
 * "verifier" wears that post's OC portrait instead of a generic whale. Only
 * unambiguous words are listed: "analyst" is a requirement analyst, but
 * "engineer" alone is not a post, so it stays in the whale tier.
 */
const OC_ALIAS_ART: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bchief\b|\bcaptain\b|\blead\b|\bhead\b|队长|总负责/, 'lead-ceo.webp'],
  [/\bpm\b|\bowner\b|\bmanager\b|产品经理|经理/, 'product-manager.webp'],
  [/\btpm\b|\bcoordinator\b|项目经理|协调/, 'program-director.webp'],
  [/\badmin\w*|行政|资源/, 'resource-admin.webp'],
  [/\bsecurity\b|\baudit\w*|\bthreat\b|合规|风控|安全|审计/, 'risk-compliance.webp'],
  [/\bresearch\w*|\binvestigat\w*|\banalyst\b|\banalys\w*|研究|调研|调查|分析/, 'requirement-analyst.webp'],
  [/\bdesign\w*|设计|视觉|交互/, 'ui-designer.webp'],
  [/\bsuccess\b|\bsupport\b|\bsales\b|客户|支持|对接/, 'client-success.webp'],
  [/\barchitect\w*|架构/, 'architect.webp'],
  [/\bdeveloper\b|\bprogrammer\b|\bcoder\b|\bserver\b|\bbackend\b|开发|后端/, 'backend-engineer.webp'],
  [/\bfrontend\b|\bfront-end\b|\bweb\b|前端/, 'frontend-engineer.webp'],
  [/\bdata\b|数据/, 'data-engineer.webp'],
  [/\balgorithm\w*|算法/, 'algorithm-engineer.webp'],
  [/\bqa\b|\bverif\w*|\btest\w*|\bquality\b|测试|验证|校验/, 'test-engineer.webp'],
  [/\breview\w*|评审|审校/, 'code-reviewer.webp'],
  [/\bdevops\b|\bsre\b|\bops\b|\brelease\b|\bdeploy\w*|运维|部署|发布/, 'ops-engineer.webp'],
  [/\bwriter\b|\bdocs?\b|\bdocument\w*|文档|撰写/, 'docs-writer.webp'],
]

/** Captain artwork: the OC lead portrait (监正 · lead-ceo). */
export const LEAD_ART = `${OC_ART_BASE}lead-ceo.webp`

/** Status action artwork per member activity (kept on whale images). */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string> = {
  working: `${ART_BASE}action-working-v2.png`,
  idle: `${ART_BASE}action-sleeping-v2.png`,
  unknown: `${ART_BASE}action-thinking-v2.png`,
}

/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * The OC portraits win first — the exact post title, then a plainer role word —
 * and the legacy whale buckets only catch what is left.
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @returns the artwork URL, or null when unmatched.
 */
export function memberArtUrl(name: string, role: string): string | null {
  const identity = `${name} ${role}`.toLowerCase()
  for (const table of [OC_ROLE_ART, OC_ALIAS_ART]) {
    for (const [pattern, art] of table) {
      if (pattern.test(identity)) return `${OC_ART_BASE}${art}`
    }
  }
  for (const [pattern, art] of ROLE_ART) {
    if (pattern.test(identity)) return `${ART_BASE}${art}`
  }
  return null
}