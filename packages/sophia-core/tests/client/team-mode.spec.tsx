/**
 * 团队模式（上游 `TeamMode`）的**行为**用例。
 *
 * ## 为什么必须有这一批（本仓纪律：新能力不能只画个控件）
 *
 * 「选模式」如果只有一枚按钮、没有任何断言，它完全可以在**功能上死掉**而测试照绿：
 * 按钮点得动、`localStorage` 也写了，但主区还是渲染原来那一页 —— 界面上看起来
 * 「没反应」。所以这里钉住三件事，缺一条就红：
 *
 * | 用例组 | 若它失守，真实故障是什么 |
 * |---|---|---|
 * | 状态机 + 持久化 | 模式切了就丢（刷新回对话）、或两份快照各说各话 |
 * | 切换控件的形态 | 按钮画出来了，但 `data-team-action` 恒 `enter` ⇒ 进了团队模式出不来 |
 * | **主区换页** | 模式值变了，**主区渲染的页面没变** ⇒ 主人说的「切了没用」 |
 *
 * ## 关于 `localStorage`
 *
 * `navigation.ts` 的既有降级是 `typeof localStorage === 'undefined'`（`navigation.ts:28`）。
 * node 环境本来没有它 ⇒ 不 stub 时读到的是**降级分支**（恒 `'conversation'`），
 * 这正是本条第一组用例要证的「默认不改变既有界面」。
 * stub 之后才验 `'team'` 那一支。
 *
 * @module tests/client/team-mode
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PanelStore } from '../../src/client/panel-store.ts'
import { TeamModeSurface } from '../../src/client/team-mode.tsx'
import { TeamNavigation, STORAGE_KEY } from '../../src/client/vendor/team/navigation.ts'
import { TeamFooterAction } from '../../src/client/vendor/team/TeamFooterAction.tsx'
import { teamTranslate } from '../../src/client/vendor/team/index.ts'
import { translatorFor } from '../../src/client/locales.ts'

/** 一个够用的假 `localStorage`：只实现 navigation.ts 真用到的那两个方法。 */
function stubStorage(seed: Record<string, string> = {}): { readonly written: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(seed))
  const written = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value)
      written.set(key, value)
    },
    removeItem: (key: string): void => { store.delete(key) },
  })
  return { written }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('t5 · 团队模式（上游 TeamMode）的行为', () => {
  // ── 组一：状态机 + 持久化 ────────────────────────────────────────────────
  it('没有 localStorage 时降级为 conversation（默认不改变既有界面）', () => {
    const navigation = new TeamNavigation()
    expect(navigation.getSnapshot().mode).toBe('conversation')
    navigation.dispose()
  })

  it('enterTeam 写进 localStorage，且**新实例读得回来**（模式不随刷新丢失）', () => {
    const { written } = stubStorage()
    const first = new TeamNavigation()
    first.actions().enterTeam()
    expect(first.getSnapshot().mode).toBe('team')
    // 真的落盘了（不是只改了内存里的快照）
    const raw = written.get(STORAGE_KEY)
    expect(raw).toBeTypeOf('string')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ mode: 'team' })
    first.dispose()
    // 换一个实例（等价于用户刷新页面）⇒ 读回同一个模式
    const second = new TeamNavigation()
    expect(second.getSnapshot().mode).toBe('team')
    second.dispose()
  })

  it('leaveTeam 切回 conversation 并同样落盘', () => {
    const { written } = stubStorage({ [STORAGE_KEY]: JSON.stringify({ mode: 'team' }) })
    const navigation = new TeamNavigation()
    expect(navigation.getSnapshot().mode).toBe('team')
    navigation.actions().leaveTeam()
    expect(navigation.getSnapshot().mode).toBe('conversation')
    expect(JSON.parse(written.get(STORAGE_KEY) ?? '{}')).toMatchObject({ mode: 'conversation' })
    navigation.dispose()
  })

  it('订阅者会被唤醒（控件才能跟着模式重画）', () => {
    stubStorage()
    const navigation = new TeamNavigation()
    let woke = 0
    const off = navigation.subscribe(() => { woke += 1 })
    navigation.actions().enterTeam()
    expect(woke).toBeGreaterThan(0)
    off()
    navigation.dispose()
  })

  // ── 组二：切换控件的形态 ────────────────────────────────────────────────
  //
  // ⚠ 这条盲区**已经补上了**（2026-09-24）。留下记录，免得后人再据旧结论放弃断言：
  //   原先 `tests/stubs/ui-primitives.ts` 把 `Tooltip` 声明成「渲染 null、**不渲染
  //   children**」，而 `TeamFooterAction` 的按钮**整个在 Tooltip 内部** ⇒ 测试环境里
  //   那枚按钮永远不在 markup 里（当时的实测输出是 `<div class="_footerStack_…"></div>`
  //   —— 外壳在、里面空的），所以本组当时只钉了外壳、没钉按钮。
  //   替身改成「转发 children」之后 **`data-team-action` 就可以断言了** ⇒ 补上。
  //   （这条也解释了当时一次真实的误判：按钮"消失"看着像产品缺了按钮，其实是替身吞了子树。）
  it('控件外壳渲染出来了，且按钮带 data-team-action', () => {
    stubStorage()
    const navigation = new TeamNavigation()
    const props = { wide: true, navigation, t: teamTranslate, ...navigation.actions() }

    const out = renderToStaticMarkup(createElement(TeamFooterAction, props))
    expect(out).toContain('_footerStack_')
    // ⚠ 反恒真：把替身的 `passChildren` 改回 `() => null` ⇒ 本条立刻变红（已实测）
    expect(out).toContain('data-team-action="enter"')
    // 字典真的是上游那份（键查得到），而不是「认不出就返回键名」的兜底路径
    expect(teamTranslate('team')).not.toBe('team')
    expect(teamTranslate('backToConversations')).not.toBe('backToConversations')

    navigation.dispose()
  })

  // ── 组三：**面板恒为团队工作区**（主人 2026-09-24 定稿：撤掉「对话 / 团队」切换）──
  //
  // 设计依据（主人原话）：「我们这个索菲亚这个按钮本身就相当于是团队这个按钮。点了就
  // 直接进入团队 ui，因此就没必要再搞一个对话和团队切换了」。
  // 上游那个开关的前提是**宿主侧栏同时承载对话与团队**，索菲亚没有这个前提。
  // ⇒ 三条真能红的断言：两个模式值下渲染面**相同**、面板内容**恒在**、切换控件**不在了**。
  it('两个模式值下渲染面相同（surface 恒为 workspace），nav-mode 只作信息', () => {
    const panel = createElement('span', { 'data-testid': 'panel-body' }, 'panel body')

    stubStorage()
    const storeA = new PanelStore()
    const asConversation = renderToStaticMarkup(createElement(TeamModeSurface, { store: storeA, children: panel }))
    expect(asConversation).toContain('data-sophia-team-surface="workspace"')
    expect(asConversation).toContain('data-sophia-nav-mode="conversation"')
    storeA.dispose()

    stubStorage({ [STORAGE_KEY]: JSON.stringify({ mode: 'team' }) })
    const storeB = new PanelStore()
    const asTeam = renderToStaticMarkup(createElement(TeamModeSurface, { store: storeB, children: panel }))
    expect(asTeam).toContain('data-sophia-team-surface="workspace"')
    expect(asTeam).toContain('data-sophia-nav-mode="team"')
    storeB.dispose()

    // ⚠ 反恒真：把 `TeamModeSurface` 改回「按 mode 选渲染面」的三元 ⇒ 本条变红
    //   （`surface` 会在 panel / conversation 之间变）。已实测。
  })

  it('面板内容恒在（收件箱头部），不再随模式消失', () => {
    stubStorage({ [STORAGE_KEY]: JSON.stringify({ mode: 'team' }) })
    const panel = createElement('span', { 'data-testid': 'panel-body' }, 'panel body')
    const store = new PanelStore()

    const markup = renderToStaticMarkup(createElement(TeamModeSurface, { store, children: panel }))
    // ⚠ 核心：即使在 team 模式下，索菲亚自己的面板内容（活动面板 / 审批卡 / DAG 画布）
    //   **也必须渲染** —— 取消会话模式之后，审批入口没有别的地方可去。
    expect(markup).toContain('data-testid="panel-body"')
    expect(markup).toContain('data-sophia-team-inbox-header')
    // 上游会话座仍在（没选频道 ⇒ 它的欢迎面）
    expect(markup).toContain('data-team-conversation')
    // 左栏也在
    expect(markup).toContain('data-sophia-team-sidebar')

    store.dispose()
  })

  it('切换控件已从界面上撤掉（surface 里不再渲染 TeamFooterAction）', () => {
    stubStorage()
    const store = new PanelStore()
    const markup = renderToStaticMarkup(createElement(TeamModeSurface, { store, children: null }))
    // ⚠ 反恒真：把它加回来（`<TeamFooterAction …/>`）⇒ 本条立刻变红。已实测。
    expect(markup).not.toContain('_footerStack_')
    expect(markup).not.toContain('data-team-action')
    store.dispose()
  })

  it('索菲亚面板里也带着这两个锚点（接线点没被后续改动摘掉）', async () => {
    stubStorage({ [STORAGE_KEY]: JSON.stringify({ mode: 'team' }) })
    // 动态取，避免与 panel.tsx 的其它用例组抢求值顺序
    const { SophiaPanel } = await import('../../src/client/panel.tsx')
    const store = new PanelStore()
    await store.load(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true, teams: [], pendingPlans: [], dagTeams: [] }),
    } as unknown as Response))
    const markup = renderToStaticMarkup(createElement(SophiaPanel, { store, t: translatorFor('zh') }))
    expect(markup).toContain('data-sophia-team-surface="workspace"')
    expect(markup).toContain('data-sophia-nav-mode="team"')
    store.dispose()
  })
})
