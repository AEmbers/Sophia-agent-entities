/**
 * Shared artwork lookup for the activity panel and the conversation card:
 * OC (original character) portraits per member role resolve first; legacy
 * whale role images act as a fallback bucket; the captain uses the OC lead.
 * @module dsh-agent-teams/client/artwork
 */
/** Legacy whale artwork route prefix served by the plugin host half. */
export const ART_BASE = '/plugins/dsh-sophia-entities/assets/';
/** OC portrait route prefix (512x512 WebP, flat slug directory). */
export const OC_ART_BASE = '/plugins/dsh-sophia-entities/sophia-assets/';
/** V2 whale role artwork per role keyword (fallback buckets). */
const ROLE_ART = [
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
];
/**
 * OC (original character) portraits, one per of the 20 member posts. The
 * Chinese post names and the modern English post labels both match, so the
 * roster text resolves deterministically instead of falling through regex
 * buckets. Source of truth for the post -> slug mapping:
 * docs/material-integration.md §4.
 */
const OC_ROLE_ART = [
    [/\bceo\b|总负责|队长|钦天监监正/, 'lead-ceo.webp'],
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
];
/** Captain artwork: the OC lead portrait (钦天监监正 · lead-ceo). */
export const LEAD_ART = `${OC_ART_BASE}lead-ceo.webp`;
/** Status action artwork per member activity (kept on whale images). */
export const ACTION_ART = {
    working: `${ART_BASE}action-working-v2.png`,
    idle: `${ART_BASE}action-sleeping-v2.png`,
    unknown: `${ART_BASE}action-thinking-v2.png`,
};
/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * OC portraits win first (deterministic per post), then legacy whale buckets.
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @returns the artwork URL, or null when unmatched.
 */
export function memberArtUrl(name, role) {
    const identity = `${name} ${role}`.toLowerCase();
    for (const [pattern, art] of OC_ROLE_ART) {
        if (pattern.test(identity))
            return `${OC_ART_BASE}${art}`;
    }
    for (const [pattern, art] of ROLE_ART) {
        if (pattern.test(identity))
            return `${ART_BASE}${art}`;
    }
    return null;
}
