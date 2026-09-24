/// <reference types="node" />
/**
 * ③ 「停止本团」禁用态的回归用例（索菲亚移植点，源文件 `src/client/vendor/panel/ActivityPanel.tsx`）。
 *
 * ## 先读这一行：这条用例覆盖什么、**不**覆盖什么
 *
 * **覆盖（静态面）**：
 * ① `bridge.ts` 的开关值 + 路由常量的命名空间；
 * ② `ActivityPanel.tsx` 里那个「不可用就不发请求」的守门点真的存在，且它的 `return`
 *    在 `fetch(` **之前**；
 * ③ 弹窗里那段**可见**说明真的渲染（用的是那个 locale 键）、确认键真的被禁用、
 *    两个 `data-halt-unavailable` 锚点都在；
 * ④ 那两句文案的 locale 键在 `zh` / `en` **两侧**都存在且非空。
 *
 * **不覆盖（交互）**：禁用态的最终表现（点开弹窗看到说明、红键按不动、指针 not-allowed）
 * 需要**展开态**渲染，而本仓的 SSG 结构上渲染不到展开态 —— `ActivityPanel.tsx:988`
 * `const [open, setOpen] = useState(false)`、`:1041` `expanded = conversationVisible &&
 * activityPanelExpandedForSession(open, openOwner, current)` ⇒ `open` 初值恒 false
 * （`tests/stubs/ui-primitives.ts` 那个测试替身解决的是「万一有测试走到展开态会崩」，
 * **不是**「能渲染展开态」）。⇒ 这条用例**不假装**覆盖了交互。
 *
 * **也不覆盖（产物）**：「`lib/client.js` 里不出现 `/api/sophia/team/halt`」这条**故意不写**。
 * 那是**构建产物**，而用例跑的是**源码**；写成断言会得到一条取决于「跑没跑过 build」的
 * 断言（恒真或恒假），正是本仓「别写恒真断言」纪律要挡的东西。
 * 产物级事实由收尾时的 grep 报出来，不进用例。
 *
 * ## 为什么用「读源码文本」这种形状
 *
 * 不是图省事：这条禁用态的**唯一可测面**就是源码与 i18n 表 —— 运行期触面
 * （展开态、弹窗交互）在本仓测试体系里结构性不可达（见上）。同类先例：
 * `tests/client-sources.spec.ts`（在源码文本上数 `require(` 次数）、
 * `tests/shell.spec.ts`（在产物文本上做断言）。
 *
 * ## 每条断言都要能红（本仓实测教训：一个从未红过的断言，与没有断言等价）
 *
 * 已做**变异双向验证**（真实输出见交接报告）：
 * 删掉 `ActivityPanel.tsx` 的守门点 → 本条红；删掉弹窗里那段可见说明 → 本条红；
 * 把开关改成 `true` → 本条红；还原 → 全绿。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HALT_URL, TEAM_HALT_AVAILABLE } from '../../src/client/vendor/bridge.ts'
import { en, zh } from '../../src/client/vendor/locales.ts'

/** 被测源文件（`ActivityPanel.tsx`）的全文。断言都跑在它上面，见文件头的"为什么这种形状"。 */
const panelSource = readFileSync(
  fileURLToPath(new URL('../../src/client/vendor/panel/ActivityPanel.tsx', import.meta.url)),
  'utf8',
)

/** 弹窗（`<primitives.Modal ... open={stopOpen}>`）在源文件里的起点。 */
const stopModalAt = panelSource.indexOf('<primitives.Modal')

/** `stopTeam` 的函数体：从声明到 `TeamSection` 的 `return (` 之前。 */
const stopTeamBody = ((): string => {
  const start = panelSource.indexOf('const stopTeam = async')
  const end = panelSource.indexOf('\n  return (', start)
  return start === -1 || end === -1 ? '' : panelSource.slice(start, end)
})()

describe('「停止本团」（索菲亚：宿主已有团队级中止路由 —— 2026-09-24 复活）', () => {
  it('开关是 true，路由指向真实的中止端点（复活三步的②③已执行）', () => {
    // 历史注记：这条断言曾是 `toBe(false)`（禁用态的看门人 —— 谁把开关置 true
    // 就会被逼回来读禁用态判据）。2026-09-24 按 `bridge.ts` 文件头记录的"复活三步"
    // 真的复活了：宿主注册 `POST /api/sophia/team/destroy`（`team/destroyed` 事件，
    // 语义 = 中止整团、保留已完成结果）⇒ 本文件整体从"禁用态守卫"改写为"启用态守卫"。
    // 反恒真：把开关改回 `false` ⇒ 本条必红（回到禁用态必须连带改写本文件）。
    expect(TEAM_HALT_AVAILABLE).toBe(true)
    // 路由必须指向**真实存在**的宿主端点（与 `tests/host-routes.spec.ts` 的
    // 路由清单逐字一致 —— 两处分叉就是「按钮点了 404」）。
    expect(HALT_URL).toBe('/api/sophia/team/destroy')
  })

  it('请求体带 teamId（宿主 parseDestroyTeamRequest 的必填字段）', () => {
    // ⚠ 宿主 `parseDestroyTeamRequest` 要求 `{teamId, reason?}`；`sessionId` 是
    //   上游形状的遗留字段（宿主忽略）。这里钉住请求体里 `teamId` 来自 `team.teamId`
    //   —— 少了它宿主会 400「teamId 必须是非空字符串」。
    expect(stopTeamBody.includes('teamId: team.teamId'), 'stopTeam 的请求体没有带 teamId: team.teamId').toBe(true)
  })

  it('守门点在 `stopTeam` 里、且在发请求之前就 return（删掉它 → 打 404）', () => {
    expect(panelSource.includes('const stopTeam = async'), 'ActivityPanel.tsx 里找不到 stopTeam').toBe(true)
    expect(stopTeamBody, 'stopTeam 的函数体没截出来（下面的断言会因此失去意义）').not.toBe('')

    const guardAt = stopTeamBody.indexOf('if (!TEAM_HALT_AVAILABLE)')
    const fetchAt = stopTeamBody.indexOf('fetch(')
    expect(guardAt, '守门点 `if (!TEAM_HALT_AVAILABLE)` 不在了').toBeGreaterThan(-1)
    expect(fetchAt, '`stopTeam` 里没有 fetch 了 —— 复活路径（宿主补路由后置 true）要求它还在').toBeGreaterThan(-1)

    // 核心断言（变异敏感的正是这一条）：守门点在 fetch **之前**。
    expect(guardAt, '守门点跑到 fetch 后面去了 —— 等于先打了 404 再显示原因').toBeLessThan(fetchAt)
    // 而且守门那一段里必须真的 `return`（写成 `if (...) { /* 什么也不做 */ }` 要能红）。
    expect(
      stopTeamBody.slice(guardAt, fetchAt).includes('return'),
      '守门点里没有 return —— 它会继续往下发请求',
    ).toBe(true)
  })

  it('弹窗里那段可见说明真的在渲染，确认键真的被禁用（删掉任何一处 → 红）', () => {
    expect(stopModalAt, '找不到停止弹窗（`<primitives.Modal`）').toBeGreaterThan(-1)

    // 可见文案：不能只断言"locale 键存在"—— 那种断言在把这段说明整段删掉后照样绿。
    const reasonAt = panelSource.indexOf("t('team.stopUnavailableDetail')", stopModalAt)
    expect(reasonAt, '弹窗正文里那段「为什么不能停」的可见说明不见了').toBeGreaterThan(stopModalAt)

    // 确认键被永久禁用（不是只靠 `stopping`）。
    expect(
      panelSource.includes('disabled={stopping || !TEAM_HALT_AVAILABLE}'),
      '弹窗确认键没有随开关禁用',
    ).toBe(true)

    // `data-halt-unavailable` 是留给将来做 DOM 断言的锚点（触发键 + 确认键各一个）。
    const anchors = panelSource.split('data-halt-unavailable').length - 1
    expect(anchors, `data-halt-unavailable 锚点少于 2 处（实为 ${anchors}）`).toBeGreaterThanOrEqual(2)
  })

  it('两句文案的 locale 键在 zh / en 两侧都存在且非空', () => {
    // 键漏一侧会在类型门就被挡（`en: Record<LocaleKey, string>` ⇒ TS2739），
    // 另有 `view-model.spec.ts:99-101` 比对两侧键集合；这里再按**本功能自己的两个键**
    // 直查一遍：类型与键集合断言管"有没有漏"，这条管"这个功能要的两句还在不在、是不是空串"。
    for (const key of ['team.stopUnavailable', 'team.stopUnavailableDetail'] as const) {
      for (const [locale, dict] of [['zh', zh], ['en', en]] as const) {
        const value: string = dict[key]
        expect(typeof value, `${locale}.${key} 类型不对`).toBe('string')
        expect(value.trim(), `${locale}.${key} 是空串（界面会出现一片无字区域）`).not.toBe('')
      }
    }
  })
})
