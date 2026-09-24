/**
 * 面板**根组件**：把 `PanelStore` 的三种状态（加载中 / 失败 / 就绪）渲染成界面。
 *
 * ## 为什么「失败」要画得跟「成功」一样清楚
 *
 * 本仓反复记录过同一个失效模式：**界面看起来正常、内容却是错的**。
 * 面板最容易踩的形态是「路由 404 ⇒ 渲染一个空列表」——用户看到的是
 * 「这个团队一个人都没有」，而真相是「数据根本没读到」。
 * 因此这里三态**必须**视觉可分：
 *
 * - 失败 ⇒ `data-sophia-state="error"` + 可读原因 + 重试按钮；
 * - 就绪但**没有团** ⇒ `data-sophia-state="empty"` + 解释性文案（`noTeamHint`）；
 * - 加载中 ⇒ `data-sophia-state="loading"`。
 *
 * `data-sophia-state` 也是端到端断言的抓手（`tests/client/panel.spec.tsx`
 * 按它判「现在到底是哪一种」，而不是去猜文案）。
 *
 * ## 增量盲区必须显式展示（不静默少显示）
 *
 * `changeScopesOf` 对 `team/thread-started` 返回 `[]`，因此**任何带 scope 的
 * 增量读取都看不到线程**（t3 实测）。宿主把这件事放进 `coverage`，
 * 这里就**如实显示一条提示** —— 否则用户会以为「线程真的就这么少」。
 *
 * @module @sophia/core/client/panel
 */

import type { ReactElement } from 'react'

import { hooks } from './react-runtime.ts'
import { CLASS, PANEL_ATTR } from './styles.ts'
// ── 上游 CSS Modules（本面板的皮肤来源）──────────────────────────────────
//
// 与 `components.tsx` 引同一份 `ActivityPanel.module.css`：构建期被
// `sophia-css-modules-inline`（`tsdown.config.ts`）编译成「CSS 文本 + 类名映射」，
// 两处引用**共用同一个模块实例**（`data-plugin-css` 按相对路径判重，
// 样式只注入一次），所以这里再引一次不会插第二份样式。
import css from './vendor/ActivityPanel.module.css'
import { canSwitchModel } from './components.tsx'
// ── 抄来的上游团队卡（收件箱 / Thread 两页 + 索菲亚的成员名册）──
//
// ⚠ 这里**不再**直接渲染 `components.tsx` 的 `TeamPanel`：消息流那一层已经换成
// 上游整份抄过来的两页（`vendor/team/`）。卡头与成员名册（换模 / 暂停 / 恢复 /
// `UpstreamTeamCard` 已不再被本文件渲染（2026-09-24 旧团队卡整体下线 ——
// 收件箱不再灌成员与频道；它独有的能力搬家去向见下面收件箱主区的长注释）。
// 组件本体保留在 team-card.tsx（勿删：它是上游资产的移植件，且有单测引用）。
import { StagingDualPlanEditor } from './StagingDualPlanEditor.tsx'
import { DagCanvas } from './DagCanvas.tsx'
// ── 移植来的上游 UI（`vendor/`）+ 它的适配层 ──
//
// 分工：`vendor/StagingPlanEditor.tsx` 是上游那份计划编辑器（名单 / 任务 / 模型
// 三块可编辑表单 + 批准行），`adapters/activity.ts` 把索菲亚 wire 映射成它期望的
// 形状，`vendor/bridge.ts` 提供翻译函数与模型目录桩。
import { StagingPlanEditor } from './vendor/StagingPlanEditor.tsx'
// ⚠ **面板级单实例**（主人点名的第一件事）：上游那个活动面板**不再**挂在每张团卡里
// （那样多团时叠出多个浮窗，截图里 4 个团叠在一起），而是挂在这里、**只挂一个**，
// 并以 `hosted`（内联）形态作为**收件箱主区的内容** ——
// 主人原话：「我说的是把这个这个UI**放进收件箱**」「把这个这个任务的 活动面板**塞进收件箱**」。
import { ActivityPanel, type PlanMode, type PlanModeControl } from './vendor/panel/ActivityPanel.tsx'
// ── 上游的「选模式」（`TeamMode`：对话 ⇄ 团队）+ 模式切换控件 ────────────────
//
// ⚠ 这一行接的是**上游**的那个模式（`vendor/team/navigation.ts` 的
//   `TeamMode`，持久化在 localStorage，切换控件 = 上游的 `TeamFooterAction`），
//   **不是**本文件里那个自研的 `PlanMode`（「建团模式：持久团 / DAG 调度」，
//   见 `planModeControl`）—— 两者语义正交，互不影响。逐项对照见
//   `team-mode.tsx` 的文件头（那里也写了「不建议合并」的判断与依据）。
import { TeamModeSurface } from './team-mode.tsx'
import { createEmptyModelDirectory, t as agentTeamsT } from './vendor/bridge.ts'
import { planToActivityTeam } from './adapters/activity.ts'

/**
 * 模型目录桩的**模块级单例**。
 *
 * ⚠ 必须单例，不能写成组件体里的 `createEmptyModelDirectory()`：
 * `StagingPlanEditor` 内部有 `useEffect(..., [modelDirectory])` 会调 `load()`，
 * 每次渲染都换引用就会**无限重订阅 / 重载**。这是「看起来只是个小对象」的经典陷阱。
 */
const EMPTY_MODEL_DIRECTORY = createEmptyModelDirectory()
import type { PanelStore, PanelSnapshot } from './panel-store.ts'
import { requestSpawnDecision } from './panel-store.ts'
import type { Translate } from './components.tsx'
import type { WireMember } from './view-model.ts'

/**
 * 订阅 store 的最小 hook。
 *
 * 为什么不用 `useSyncExternalStore`：它需要 React 18 的具名导出，
 * 而我们只通过惰性的 React 取用拿一个**结构化面**（`ReactFace`）。
   * （此处刻意不写出那个模块加载字面量 —— `tests/client-sources.spec.ts` 是在
   * bundle 字符串上做文本级统计的，注释里的字面量同样计入。）
 * 为了一个订阅去扩那个面，会让「宿主 React 版本差异」的影响面变大。
 * 这里用 `useState` + `useEffect(subscribe)`，语义等价且只用到最稳的两个 hook。
 */
/**
 * 订阅 store，然后**立刻补读一次**。
 *
 * ⚠ 抽成具名函数是为了能**真的测**（本仓没有 jsdom/happy-dom，
 * `useEffect` 的订阅顺序在 SSR 下跑不到）：
 * 顺序本身就是这条修复的全部内容 —— **先订阅、再补读**。
 * 反过来写（初版）会在这两句之间漏掉一次 emit，而 `emit` 不重放历史
 * ⇒ 面板永久停在一个过期快照上，直到下一次状态变化。
 *
 * 这里把顺序固定在一个可被单测直接调用的地方，而不是埋在 hook 里
 * 「靠读代码相信它是对的」。
 */
export function subscribeThenSync(store: PanelStore, sync: () => void): () => void {
  // 订阅在前：这之后的任何 emit 都能到达 sync。
  const unsubscribe = store.subscribe(sync)
  // 补读在后：两次 render 之间 store 可能已经变了，只订阅不补读会停在旧值上。
  sync()
  return unsubscribe
}

/**
 * 判出面板当前处于哪一态。
 *
 * ⚠ 抽成函数（OCR 复核 LOW）而不是内联三层嵌套三元 —— 本仓检查单明确禁止
 * 嵌套三元（`components.tsx` 的 `dotVisualOf` / `segmentToneOf` 都是为此抽出来的），
 * 且**这个判据必须只有一处**：它同时决定 body 与根元素的 `data-sophia-state`，
 * 分叉就会出现「根说 loading、body 是旧内容」那类自相矛盾的 DOM（OCR 复核 HIGH）。
 *
 * 优先级：loading（含重试中）> error > empty > ready。
 * `loading` 覆盖「重试中」：此时确有刷新在途，如实显示加载态比显示陈旧内容正确。
 */
export function phaseOf(snapshot: PanelSnapshot): 'loading' | 'error' | 'empty' | 'ready' {
  if (snapshot.status === 'loading') return 'loading'
  if (snapshot.status === 'error') return 'error'
  if (snapshot.view === null || snapshot.view.teams.length === 0) return 'empty'
  return 'ready'
}

function usePanelSnapshot(store: PanelStore): PanelSnapshot {
  const { useState, useEffect } = hooks()
  const [snapshot, setSnapshot] = useState(store.getSnapshot())
  useEffect(() => subscribeThenSync(store, () => {
    setSnapshot(store.getSnapshot())
  }), [store])
  return snapshot
}

/**
 * 用户点「重试」时的加载。
 *
 * ⚠ 抽成具名函数同样是**为了能真的测**（理由同上）：重试是**人的操作**，
 * 必须 `force` —— 否则慢请求进行中点击会被 store 的「并发合并」静默吞掉
 * （不发请求、无 loading、界面无变化），用户只会觉得按钮坏了。
 * 合成一行 `void store.load(fetch, { force: true })` 藏在 JSX 的 onClick 里，
 * 单测就够不到它。
 */
export function reloadForRetry(store: PanelStore): void {
  void store.load(fetch, { force: true })
}

/**
 * 面板重读间隔（毫秒）。
 *
 * 取值理由：够快让人感到「它自己会更新」，又不至于把 `GET /api/sophia/view`
 * 打成高频热点（该路由本身是热路径，见 `src/host-data.ts` 的说明）。
 */
export const PANEL_POLL_MS = 4000

/** 失败态。 */
/**
 * 把宿主/网络给的原始错误串**脱敏**后再进 DOM。
 *
 * ⚠ 为什么不能原样渲染（OCR 复核 MEDIUM·安全）：浏览器给的
 * `Failed to fetch http://<内网主机>:<端口>/api/sophia/view` 会把**部署内部
 * 主机名、端口与路由**一起写进界面与 `data-sophia-error` 属性 ——
 * 任何能看到面板（或抓取该属性）的人都能读到。这跟本仓既定纪律
 * 「错误边界不得暴露 stack / 绝对路径」是同一类问题。
 *
 * 判据：**保留排障价值、去掉定位信息**。
 * - 去掉完整 URL 与绝对路径（`http(s)://…`、Windows 盘符路径）；
 * - 保留错误**种类**（`Failed to fetch`、`HTTP 404` 等）——那才是排障要看的；
 * - 完整原文走 `console`，需要时到控制台看。
 */
export function sanitizeErrorForDom(raw: string): string {
  return raw
    // 完整 URL（含主机/端口/路径）→ 只留占位。
    .replace(/https?:\/\/[^\s"'`)]+/gi, '<url>')
    // Windows 绝对路径（`C:\a\b` 或 `C:/a/b`）。
    .replace(/\b[A-Za-z]:[\\/][^\s"'`)]*/g, '<path>')
    // ⚠ **裸的 IPv4（可带端口）**（OCR 复核 HIGH 抓到的真实缺口）：
    //   初版只匹配 `.local`/`.internal`/`.lan` 结尾的主机名，
    //   而错误串里的内网地址**经常不带协议**（`connect ECONNREFUSED 10.0.0.5:8080`）。
    //   只挡 `http://…` 那一种形态，等于把最常见的泄露形态放过去。
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<host>')
    // ⚠ OCR HIGH：**方括号 IPv6**（`[fd00:1]:8080`、`[2001:db8::1]`）——
    //   `[`/`]` 同时破坏下面通用 `主机:端口` 正则的首字符类与 `\b` 收尾，
    //   整串会原样进 DOM（内网拓扑泄露）。必须在通用规则**之前**挡掉。
    .replace(/\[[0-9a-f:.]+\](?::\d{1,5})?/gi, '<host>')
    // 已知内网后缀的主机名（可带端口）。
    .replace(/\b[a-z0-9.-]+\.(?:local|internal|lan|corp|home)(?::\d+)?\b/gi, '<host>')
    // ⚠ **通用 `主机:端口`**：只要满足「有端口号」这个强特征就脱敏 ——
    //   带端口的地址几乎必然是内部服务（公网服务极少在错误文案里带端口）。
    //   放在最后：前面的规则已经处理了带协议与 IP 的形态。
    .replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*:\d{2,5}\b/gi, '<host>')
    // 本机回环的各种写法（`localhost`、`127.0.0.1` 已被上面覆盖）。
    .replace(/\blocalhost\b/gi, '<host>')
    .trim()
}

/** 读失败时的可读错误视图（带重试）。 */
function ErrorView(props: {
  readonly t: Translate
  readonly error: string
  readonly onRetry: () => void
}): ReactElement | null {
  const { t, error, onRetry } = props
  const { useEffect } = hooks()
  const safe = sanitizeErrorForDom(error)
  // ⚠ **日志放在 effect 里，不放在渲染体内**（OCR 复核 MEDIUM）：
  //   渲染体必须是纯的 —— 它可能因 StrictMode / 并发渲染 / 父组件重渲染而
  //   执行多次，把 `console.warn` 写在里面就会**按渲染次数重复打印**同一条错。
  //   依赖数组用 `[error]`：只有**真的换了错误**才打一次。
  //   完整原文只进控制台（低暴露面），界面上是脱敏版 —— 排障时两边都够用。
  useEffect(() => {
    // OCR MEDIUM：**无条件**打原文 —— 旧守卫 `safe !== error` 让「无敏感内容、
    // 脱敏后原样」的错误（`Failed to fetch`、`network down`）永远进不了控制台，
    // 与上面「完整原文只进控制台」的承诺自相矛盾（诊断通道根本没建起来）。
    console.warn(`[sophia] read failed (raw): ${error}`)
    // `safe` 由 `error` 决定，故只需监听 `error`。
  }, [error])
  return (
    // 皮肤：上游 `css.taskDetail` 的卡片语言（浅底 + 边框 + 9px 圆角 + 竖排 3px 间距），
    // 标题/说明分别吃 `css.panelTitle` / `css.taskDetailLine`。
    // ⚠ `CLASS.error` 的**语义色**（错误边框）刻意保留 —— 视觉同级不等于
    //   把「这是失败」这件事抹平成中性卡片。
    <div className={`${CLASS.error} ${css.taskDetail}`} data-sophia-state="error">
      <div className={`${CLASS.emptyTitle} ${css.panelTitle}`}>{t('unavailableTitle')}</div>
      <div className={`${CLASS.emptyHint} ${css.taskDetailLine}`}>{t('unavailableHint')}</div>
      {/* 脱敏后的原因：既不是无从排障的「出错了」，也不泄露内网拓扑。 */}
      {safe === ''
        ? null
        : <div className={`${CLASS.emptyHint} ${css.taskDetailLine}`} data-sophia-error>{safe}</div>}
      <button type="button" className={CLASS.bumpButton} data-sophia-action="retry" onClick={onRetry}>
        {t('retry')}
      </button>
    </div>
  )
}

/** 空态（读到了、但还没有任何团）。 */
/**
 * 零团空态：**完整侧栏骨架** + 主区引导（对标上游 dsh-agent-team ——
 * 主人实测指出：上游哪怕一个团也没有，收件箱/频道/Agents 三分区也常在，
 * 而我们曾只给两行字。骨架与 ready 态的 `TeamPanel` 同构：
 * `header + body(sidebar + main)`，CSS 复用 `sp-sidebar*` 现有类。
 */
function EmptyView(props: { readonly t: Translate }): ReactElement | null {
  const { t } = props
  return (
    <>
      {/* 面板头与 ready 态同源（上游 `css.panelHead` + `css.panelTitle`）——
          两态的头不该长得像两个不同的面板。 */}
      <header className={`${CLASS.header} ${css.panelHead}`}>
        <span className={`${CLASS.headerTitle} ${css.panelTitle}`}>{t('teams')}</span>
      </header>
      <div className={CLASS.body}>
        <div className={CLASS.sidebar} data-sophia-sidebar="skeleton">
          <section className={CLASS.sidebarSection}>
            <div className={CLASS.sidebarSectionTitle}>{t('inboxTitle')}</div>
            <div className={CLASS.emptyHint}>{t('inboxEmpty')}</div>
          </section>
          <section className={CLASS.sidebarSection}>
            <div className={CLASS.sidebarSectionTitle}>{t('channels')}</div>
            <div className={CLASS.emptyHint} data-sophia-channels="empty">{t('emptyChannels')}</div>
          </section>
          <section className={CLASS.sidebarSection}>
            <div className={CLASS.sidebarSectionTitle}>{t('agents')}</div>
            <div className={CLASS.emptyHint} data-sophia-agents="empty">{t('emptyAgents')}</div>
          </section>
        </div>
        <div className={CLASS.main}>
          <div className={CLASS.empty} data-sophia-state="empty">
            <div className={CLASS.emptyTitle}>{t('noTeam')}</div>
            <div className={CLASS.emptyHint}>{t('noTeamHint')}</div>
            <div className={CLASS.emptyHint} data-sophia-create-hint>{t('createTeamHint')}</div>
          </div>
        </div>
      </div>
    </>
  )
}

/** 增量盲区 + 投影诊断提示（如实声明，见文件头）。 */
export function CoverageNotice(props: {
  readonly snapshot: PanelSnapshot
  readonly t: Translate
}): ReactElement | null {
  const { snapshot, t } = props
  const view = snapshot.view
  if (view === null) return null
  const coverage = view.coverage
  const malformed = view.malformedEvents ?? 0
  const unresolved = view.unresolvedReferences ?? 0
  const parts: ReactElement[] = []
  if (coverage !== undefined && coverage.scoped && coverage.unscopedKindsOmitted.length > 0) {
    parts.push(
      <div className={`${css.taskDetailLine}`} key="coverage" data-sophia-coverage="scoped">
        {t('coverageNotice', {
          count: coverage.unscopedKindsOmitted.length,
          kinds: coverage.unscopedKindsOmitted.join(', '),
        })}
      </div>,
    )
  }
  if (malformed > 0 || unresolved > 0) {
    parts.push(
      <div className={`${css.taskDetailLine}`} key="diagnostics" data-sophia-diagnostics="present">
        {t('diagnosticsNotice', { malformed, unresolved })}
      </div>,
    )
  }
  if (parts.length === 0) return null
  return (
    // 皮肤：与错误卡同语言 —— 上游 `css.taskDetail` 卡片 + `taskDetailSubject` 标题。
    <div className={`${CLASS.coverageNotice} ${css.taskDetail}`} data-sophia-notices={parts.length}>
      {/* 标题不是装饰：一条孤零零的说明文字会被当成界面噪声跳过。
          有标题才看得出「这是一条关于**数据完整性**的提示」，而不是
          某种操作说明。`coverageTitle` 就是为它准备的键。 */}
      {/* 标题的类名只剩上游 taskDetailSubject —— 本地那个 `sp-notices-title`
          已随它的规则一起删掉（OCR 复核 MEDIUM [26]：无规则的键会被人
          当成「样式丢了」而去补一条重复的）。属性锚点 `data-sophia-notice-title` 保留。 */}
      <div className={css.taskDetailSubject} data-sophia-notice-title>
        {t('coverageTitle')}
      </div>
      {parts}
    </div>
  )
}

/**
 * 面板根组件。
 *
 * @param props - `store` 由挂载层持有（随 `ctx.effect` 回收）；`t` 由语言决定。
 */
export function SophiaPanel(props: {
  readonly store: PanelStore
  readonly t: Translate
  readonly onSwitchModel?: ((member: WireMember) => void) | undefined
  readonly onDecide?: ((requestId: string, decision: 'approve' | 'reject') => Promise<void>) | undefined
  readonly onLifecycle?: ((memberId: string, action: 'suspend' | 'resume') => Promise<void>) | undefined
  readonly onCreateChannel?: ((title: string) => Promise<void>) | undefined
  readonly onAddMember?: ((position: string) => Promise<void>) | undefined
}): ReactElement | null {
  const { store, t, onSwitchModel, onDecide, onLifecycle, onCreateChannel, onAddMember } = props
  const snapshot = usePanelSnapshot(store)
  // ⚠ `useMemo`/`useCallback` 也取自同一个 `hooks()` 面（本仓不许直接 import React 的
  //   具名导出：`react-runtime.ts` 的文件头记了原因）。这里**必须** memo：
  //   `ActivityPanel` 会把 `planMode` 当依赖用（读值/写值），每次渲染换一个对象
  //   会让它的渲染无谓地跟着整个面板的 4 秒轮询跑。
  const { useState, useEffect, useMemo, useCallback, useRef } = hooks()
  // ⚠ OCR [22]（MEDIUM，2026-09-24 本轮引入的接线的次生问题）：
  //   `TeamModeSurface` 把 `onSwitchModel` 放进了 `createTeamSidebarSource` 的
  //   `useMemo` deps ⇒ 上游 seats 每次渲染都给一个**新箭头函数**，会让左栏数据源
  //   （连带会话座 props）每 4 秒轮询一次就整体重建。修法：ref 存最新回调 +
  //   `useCallback` 产出**稳定引用**传下去 —— 数据源只在真正换 store/navigation 时重建。
  const onSwitchModelRef = useRef(onSwitchModel)
  onSwitchModelRef.current = onSwitchModel
  const stableOnSwitchModel = useCallback(
    (member: WireMember): void => { onSwitchModelRef.current?.(member) },
    [],
  )

  // 挂载读一次 + **定时重读**（`store.load()` 自己合并并发，故不会堆积请求）。
  //
  // ⚠ 为什么必须轮询（2026-09-24 线上实测的真实缺陷）：外部事实会**独立于本面板**
  //   变化 —— 索菲亚在对话里建团、发起持久团申请（待批票）、成员增删。
  //   只读一次的话，用户必须**切走再切回**才看得到新数据；实测中「面板显示空态、
  //   其实账本里早就有团」这个第一印象正来自这里（审批卡也是切回后才出现的）。
  //   `src/host-data.ts` 的注释也早写着 `GET /api/sophia/view` 是
  //   **热路径（界面在轮询它）** —— 设计如此，只是实现漏了这一环。
  useEffect(() => {
    void store.load()
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      // ⚠ `background: true` 是**承重**的：不传它，每次轮询都会把 store 打成
      // loading 态 ⇒ 这里 body 换成 loading 视图 ⇒ `TeamPanel` 卸载重挂（用户选的
      // 频道/线程被定时器重置）+ 每 4 秒可见地闪一下（OCR 复核指出）。
      // 第一个参数传 `undefined` = 「用默认的 fetch 实现」（`load` 的形参默认值）。
      void store.load(undefined, { background: true })
    }, PANEL_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [store])

  const retry = (): void => {
    reloadForRetry(store)
  }

  // ⚠ **单一状态源**（OCR 复核 HIGH 抓到的真实缺陷）：初版的
  //   「加载中」判据是 `status === 'loading' && view === null`，而根元素的
  //   `data-sophia-state` 直接取 `snapshot.status`。于是**重试**时
  //   （`load()` 发 `{...snapshot, status:'loading'}` 但**不清** `view`）
  //   出现自相矛盾的 DOM：根元素说 `loading`，body 却渲染**上一次的**内容，
  //   而「加载中」提示被静默丢掉 ⇒ 重试期间**没有任何反馈**。
  //   任何按 `data-sophia-state` 判断「现在处于三态中的哪一个」的消费者
  //   （含本文件的端到端断言）都会读到一个错误的答案。
  //
  //   修法：**先判出一个状态，再由它同时决定 body 与根属性** ——
  //   两者来自同一次判断，结构上不可能不一致。
  //   `loading` 覆盖「重试中」：此时确有刷新在途，如实显示加载态比显示陈旧内容正确。
  //
  // ⚠ 抽成函数（OCR 复核 LOW）：内联写就是三层嵌套三元，本仓检查单明确禁止
  //   （`components.tsx` 的 `dotVisualOf` / `segmentToneOf` 都是为此抽出来的）。
  const phase = phaseOf(snapshot)
  // ⚠ **全部团**，不是 `teams[0]`。
  // 初版只取第一个团 ⇒ 用户在另一个窗口建的持久化团在面板上**根本不显示**，
  // 症状就是「我明明创建了，界面却没反应」。而主人的模型是：一个窗口建的持久团挂它
  // 自己的专属频道，另一个窗口建的团挂另一个频道，**由频道做隔离与分类** ——
  // 所以要列出来的必须是全部团，而不是任意一个。
  const teams = phase === 'ready' ? (snapshot.view?.teams ?? []) : []
  // 「主团」＝第一张卡。运营三件套（建频道 / 加成员 / 生命周期）目前仍是**单团语义**
  // （`seats.tsx` 的 `currentTeamId()` 与本行同源），所以那几个按钮只挂在主团卡上。
  // 保留这个变量名，是为了让 `hasSwitchableMember` 等既有判据继续与渲染同源。
  const team = teams[0] ?? null

  // 审批区（文档 3.6）：只显示**待处理**的票（awaiting）。
  // ⚠ 不挂 `phase === 'ready'` —— 首团申请时零团是 `empty`，那张票正是
  //   用户此刻唯一要处理的东西；挂错分支它就永远不出现（断言第 1 条盯这个）。
  const pendingPlans = (snapshot.view?.pendingPlans ?? [])
    .filter((plan) => plan.status === 'awaiting')
  // DAG 画布（文档 5）：只读、无回调；空表不占版面。
  const dagTeams = snapshot.view?.dagTeams ?? []

  /** 建团模式（主人点名缺失的「选模式」）：**唯一真源就在这里**。
   *
   *  - 面板里有两处会显示它：活动面板的「拟建团」块（`ActivityPanel` 的 `planMode`）
   *    与索菲亚审批卡的既有单选（`StagingDualPlanEditor`）。**只在这里存一份**
   *    （那两处都是 display/input，不各存一份状态 ⇒ 不可能两处显示不一致）。
   *  - 缺省 `persistent`：DAG 调度链路在本版**没有实现**（选项本身是禁用 + 写明
   *    「阶段 3 开放」），所以「没选过」的语义只能是持久团。
   *  - 键用 `requestId`：拟建态的 `teamId` **就是** `requestId`
   *    （`adapters/activity.ts:225`），活动面板那边拿到的 `team.teamId` 即它。 */
  const [planModes, setPlanModes] = useState<Record<string, PlanMode>>({})
  const planModeControl: PlanModeControl = useMemo(() => ({
    // ⚠ 三个文案用**索菲亚自己的字典**翻（与审批卡同一批键）—— 两处 UI 因此不可能
    //   「一边一个说法」。活动面板那份 `t` 是上游字典，没有这三个键（实测 TS2345）。
    label: t('modeLabel'),
    persistentLabel: t('modePersistent'),
    dagLabel: t('modeDag'),
    value: (requestId: string): PlanMode => planModes[requestId] ?? 'persistent',
    onChange: (requestId: string, mode: PlanMode): void => {
      setPlanModes((prev) => (prev[requestId] === mode ? prev : { ...prev, [requestId]: mode }))
    },
  }), [planModes, t])

  /** 「确认」按下时交出当前选中的模式（`ActivityPanel` 的 `onApproveWithMode`）。
   *
   *  ⚠⚠ **如实说明它现在到不了哪儿**（不是「已生效」）：活动面板内部的
   *  「确认并启动团队」属于 `StagingPlanEditor`，它的写动作 POST 的是上游载荷
   *  `{ sessionId, teamId, action }`，而索菲亚决策路由解析 `{ requestId, decision }`
   *  ⇒ 那条路本身就会被宿主 400（这一段在文件里早已有记录，见审批块的长注释）。
   *  真正能生效的确认是索菲亚审批卡 → `onDecide` → `panel-store.ts:584` 的
   *  `{ requestId, decision }`；那个载荷**没有** `mode` 字段，宿主契约
   *  `SpawnDecisionRequest`（`host-data.ts:602-637`）也没有。
   *  ⇒ 结论：**「选中值进确认动作」在本次施工边界内只能走到这里**；
   *    要让它真的影响建团结果，需要 `seats.tsx` / `panel-store.ts` / 宿主三处各加一个
   *    `mode` 字段（都不在本次边界内，报告里给了逐处改法与依据）。
   *  这里诚实地把它记进 console 并落在 DOM 上（`data-sophia-mode-confirmed`），
   *  不假装它已经生效。 */
  const [confirmedMode, setConfirmedMode] = useState<string>('')
  const handleApproveWithMode = useCallback((requestId: string, mode: PlanMode): void => {
    setConfirmedMode(`${requestId}:${mode}`)
    console.info('[sophia] 确认建团时选中的模式 =', requestId, mode)
  }, [])

  let body: ReactElement | null
  if (phase === 'loading') {
    body = (
      <div className={CLASS.loading} data-sophia-state="loading">{t('loading')}</div>
    )
  } else if (phase === 'error') {
    // ⚠ 原始错误串**不进 DOM**（OCR 复核 MEDIUM·安全）：浏览器给的
    //   `Failed to fetch http://<内网主机>/api/sophia/view` 会连**部署内部
    //   主机名与路由**一起泄露给任何能看到面板/抓这个属性的人。
    //   界面上只给已翻译的可读提示；诊断串走 console（低暴露面）。
    body = <ErrorView t={t} error={snapshot.error ?? ''} onRetry={retry} />
  } else if (phase === 'empty' || teams.length === 0) {
    body = <EmptyView t={t} />
  } else {
    body = (
      // `data-sophia-team` 指向**主团**（第一张卡）而不是某个随机团：既有断言与
      // `seats.tsx` 的运营入口都按「主团」这个语义读它。
      // 新增 `data-sophia-team-count` 让「面板列出了几个团」这件事**可被断言** ——
      // 否则「只显示第一个团」这个缺陷在 DOM 上不可观测（本仓纪律：新增能力要有能红的断言）。
      <div
        data-sophia-state="ready"
        data-sophia-team={teams[0]?.teamId ?? ''}
        data-sophia-team-count={teams.length}
      >
      {/* ── 收件箱主区 ────────────────────────────────────────────────────────
          主人 2026-09-24 第三次反馈（截图）：「为啥点进去收件箱里面会有成员和频道」——
          那一块是旧团队卡（`UpstreamTeamCard`）的残余：它自带频道成员列表 + 名册，
          而这些在团队工作区（左栏 收件箱/频道/Agents + 成员入口）已经是正式入口，
          再渲染一遍就是把"成员和频道"灌进收件箱。
          ⇒ **整卡不再渲染**。它独有的能力盘点（删前逐一核对，不是拍脑袋删）：
            · 建频道 / 加成员输入框 —— 上一轮已停传回调，本就不再渲染；
            · 挂起 / 恢复 —— 左栏 Agents 面板行菜单有（`TeamAgentsPanel.tsx:296-300`，
              `suspendAgent` / `resumeAgent`）；
            · **换模** —— 目前**只在**旧卡名册上（`components.tsx:269`
              `data-sophia-action="switch-model"`），左栏 Agents 面板**没有**这个动作。
              ⇒ 删卡前先把换模接进左栏 Agents 行菜单，否则这是**砍功能**。
              接线点：`TeamAgentsPanel` 的 `AgentRow` 菜单 + `sidebarProps` 的
              `setMemberLifecycle` 同槽加一个 `onSwitchModel`（见 team-mode.tsx）。
          在换模接线完成前，`hasSwitchableMember` / `data-sophia-pluginswitch`
          仍按名册数据如实上报（能力在后端都在，只是界面入口搬家）。 */}
      <div className={CLASS.body} data-sophia-inbox="main">
        <div className={CLASS.main}>
          <ActivityPanel
            hosted
            conversationVisible
            // ⚠ `scope` 传**空串**而不是 `undefined`：索菲亚的团**不绑会话**，
            //   适配器给的 `captainSessionId` 就是 `''`，空串在上游语义里是
            //   **合法的当前作用域**；`undefined` 表示「没有当前会话 ⇒ 什么都不显示」。
            scope=""
            modelDirectory={EMPTY_MODEL_DIRECTORY}
            // 索菲亚**没有**「把成员会话嵌进会话座」这条路（见 `vendor/team/slots.ts`
            // 的剥除清单），所以点了不跳转 —— 不留假导航，等宿主长出那个能力再接。
            openMember={() => undefined}
            source={props.store}
            t={agentTeamsT}
            planMode={planModeControl}
            onApproveWithMode={handleApproveWithMode}
            // ⚠ 拟建团的**写动作**接索菲亚真实契约（2026-09-24 主人实测：确认报
            //   「requestId @… 归属任务不存在」、放弃无响应 —— 病根是上游编辑器
            //   发的 `{sessionId, teamId, action}` 载荷不是宿主 decision 契约）。
            //   approve：`requestSpawnDecision(requestId,'approve')` —— 宿主落
            //   `spawn/human-approved` 并建团（或幂等回放）；同时把选中的建团模式
            //   记进 `confirmedMode`（机器可核，与 handleApproveWithMode 同口径）。
            //   discard：`requestSpawnDecision(requestId,'reject')` —— 账本终态，
            //   不可撤回（这就是「放弃本次计划」的真实语义）。
            //   `requestId` 由 ActivityPanel 在 map 内绑定（拟建态 teamId === requestId）。
            //   结果通过 store 的 notice（成功清 / 失败设）与后台重读呈现 ——
            //   与 seats.tsx 的 onDecide 同一套口径，不另造一套反馈。
            onPlanAction={async (action, requestId) => {
              const result = await requestSpawnDecision(
                requestId,
                action === 'approve' ? 'approve' : 'reject',
              )
              if (result.kind === 'failed') {
                // 抛给 StagingPlanEditor 的反馈行（plan.failed 模板）——
                // 让错误出现在**按下按钮的那张卡**上，而不是只进全局 notice。
                throw new Error(result.detail)
              }
              if (action === 'approve') setConfirmedMode(`${requestId}:${planModeControl.value(requestId)}`)
              store.setNotice(null)
              void store.load(undefined, { background: true })
            }}
          />
          {/* 旧团队卡已整体下线（见上面长注释的能力盘点与换模搬家计划）。 */}
        </div>
      </div>
      </div>
    )
  }

  /**
   * 换模入口是否**真的**在 DOM 里。
   *
   * ⚠ 判据必须与 `MemberCard` **同源**：直接调 `canSwitchModel`
   *   （OCR 复核 MEDIUM 指出初版是**抄了一份条件**，而注释却声称「同源」——
   *    注释与代码不一致，两处一分叉属性就会谎报 DOM 里不存在的能力）。
   */
  const hasSwitchableMember = phase === 'ready' && team !== null
    && team.members.some(canSwitchModel)

  return (
    <div
      className={CLASS.root}
      {...{ [PANEL_ATTR]: '' }}
      // 与 body 同源（见上面 `phase` 的说明），不再直接取 `snapshot.status`。
      data-sophia-state={phase}
      data-sophia-pluginswitch={
        onSwitchModel !== undefined && hasSwitchableMember ? 'present' : 'absent'
      }
      // 审批区是否真的在 DOM 里（与 pluginswitch 同纪律：回调没接就不许 present）。
      data-sophia-approval={
        onDecide !== undefined && pendingPlans.length > 0 ? 'present' : 'absent'
      }
      // ⚠ **「确认时选中的建团模式」到了哪一层，机器可核**（空串 = 还没确认过）。
      //   ⚠ 名字里的 "confirmed" 说的是**本边界**：值只证明「审批卡把选中值交到了
      //   `panel.tsx`」—— 它**不**证明进了宿主载荷（`panel-store.ts:584` 发的
      //   `{ requestId, decision }` 目前没有 `mode` 字段，宿主契约也没有）。
      //   OCR [20]（MEDIUM）指出原名会诱导检查者高估它的语义 ⇒ 这里把边界写死。
      //   真要让它生效，需 `seats.tsx` / `panel-store.ts` / 宿主三处各加 `mode`（见文件头说明）。
      data-sophia-mode-confirmed={confirmedMode === '' ? undefined : confirmedMode}
    >
      <CoverageNotice snapshot={snapshot} t={t} />
      {/* ⚠ **非致命提示**（captain 派修的 HIGH 的 UI 出口）：
          「换模已生效但审计序号异常」必须**在界面上可见** —— 只写 console
          等于用户看不到，而宿主专门用 200 传的那个标记就白费了。
          用警示样式（不是错误样式）：它**不是**失败、且**不能**提示重试
          （重试会写第二条换模事件）。文案已把「已生效 / 勿重试」说清。
          与 `error` 分开渲染：两者对用户的要求相反（一个要重试、一个别重试）。
          ⚠ 位置：**在收件箱之上**（本轮把它从「收件箱之后」挪上来）——
          这些提示是「你现在需要知道的事」，掉到长页面底部等于不存在。 */}
      {snapshot.notice === null
        ? null
        : (
            <div className={CLASS.notice} data-sophia-notice="present" role="status">
              {/* OCR MEDIUM [第五轮]：notice 是**通用**非致命提示（失败/异常都写它）——
                  属性值曾写死 'applied-with-anomaly'，消费者会把普通失败读成
                  「已生效勿重试」。store 不携带 kind ⇒ 属性退化为**存在性**语义。 */}
              {snapshot.notice}
            </div>
          )}
      {/* ⚠ **收件箱内容排在审批卡与 DAG 画布之前**（本轮的核心改动之一）：
          主人要求收件箱是主容器、第一眼就该看到它；而待批计划的编辑器很长，
          排在前面会把收件箱挤到屏幕外（改造前实测 y>1163，见交付报告的坐标证据）。 */}
      {/* ⚠ 这一层是**上游模式机制**的接线点（`team-mode.tsx`）：
          `'conversation'`（默认，含 SSR/无 localStorage 的降级）时它原样渲染下面这一整块；
          `'team'` 时主区换成上游的团队会话座（收件箱 / Thread / 频道三页），
          并在最下面画那枚模式切换按钮。DOM 上留了
          `data-sophia-team-mode` / `data-sophia-team-surface` 两个锚点。 */}
      <TeamModeSurface store={store} onSwitchModel={stableOnSwitchModel}>
      {body}
      {onDecide !== undefined && pendingPlans.length > 0 ? (
                <>
          {/* ── 上游计划编辑器（移植 · **当前是只读预览态**）──────────────
              渲染「拟建团」的完整计划形态：名单（职位 / 数量 / 模型）、任务清单、
              依赖统计、批准行。数据来自 `planToActivityTeam`（待批票 → 拟建态团队）——
              待批票描述的是**还没成立的团**，所以不能从已存在的 team 映射。

              ⚠⚠ **它的写动作当前一律不可用** —— 这是实测结论，不是推测（OCR 复核 HIGH [2]
              指出本注释初版与事实不符，此处改为如实描述）：`StagingPlanEditor` 的写入口会
              POST `{ sessionId, teamId, action }`（action ∈ approve / discard / continue /
              add_task / update_member …），而索菲亚的决策路由解析 `{ requestId, decision }`
              ⇒ **每个写动作都会被宿主以 400 拒绝**，表现为卡片反馈行里的一条错误。
              要让它真正可写，需要宿主半新增 `/api/sophia/plan` 路由做载荷换算（**尚未实现**）。

              ⇒ 故本组件当前只承载**计划的可视化预览**；**决策动作一律走下面那张索菲亚审批卡**
              （它的批准 / 驳回确实能工作）。`onDiscarded` 也刻意留空：最初把它接到
              `onDecide(..., 'reject')` 时，同一个 requestId 就有了**两个活的决策面**
              （OCR 复核 HIGH [1]）—— 在一张卡上驳回、再到另一张上批准，第二次 POST 会命中
              已决策的票，宿主返回 409 并在界面上弹出虚假的失败提示。
              **一个 requestId 只能有一个决策入口**。

              ⚠⚠ **「只读」必须由 HTML 语义保证，不能只靠 CSS**
              （OCR 复核 HIGH [11] 抓到）：容器之所以是 `fieldset disabled` 而不是
              一个普通盒子，是因为 `pointer-events: none` 只挡**指针** ——
              键盘用户按 Tab 仍能聚焦里面的按钮、按回车仍会触发它，
              那些写动作照样会 POST 出去、拿到 400、在卡片上弹出一条虚假失败。
              `fieldset disabled` 是浏览器**强制**的：整棵子树的表单控件
              不可聚焦、不可激活、不参与提交。`data-sophia-plan-preview`
              属性与它的值**原样保留**（既有锚点）；fieldset 自带的默认外观
              在 styles.ts 里归零。 */}
          {pendingPlans
            .filter((plan) => plan.status === 'awaiting')
            .map((plan) => (
              <fieldset key={plan.requestId} data-sophia-plan-preview="true" disabled>
                <StagingPlanEditor
                  team={planToActivityTeam(plan)}
                  modelDirectory={EMPTY_MODEL_DIRECTORY}
                  onContinuePlanning={() => {}}
                  onDiscarded={() => {}}
                  t={agentTeamsT}
                />
              </fieldset>
            ))}
          {/* ── 索菲亚自己的审批卡（保留）───────────────────────────
              它的批准 / 驳回**确实能工作**（走索菲亚的决策路由）。两者分工：
              上游编辑器提供完整的计划编辑形态，这张卡提供可用的决策动作。
              ⚠ 2026-09-24（团长授权）：模式单选**受控于同一个真源** `planModeControl`
              —— 与活动面板拟建团块那处读/写同一份状态，两处不可能显示不一致。 */}
          <StagingDualPlanEditor plans={pendingPlans} t={t} onDecide={onDecide} planMode={planModeControl} />
        </>
      ) : null}
      {dagTeams.length > 0 ? <DagCanvas dagTeams={dagTeams} t={t} /> : null}
      </TeamModeSurface>
    </div>
  )
}
