/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
 * panel that docks at the conversation's top-right edge by default, can be
 * dragged into a floating window, resized, and folded into an activity badge.
 * On wide viewports the docked panel makes the conversation column yield
 * space; narrow viewports keep a simple inset overlay. It
 * reads server-side snapshots (durable files + live work), with a
 * collapsed badge that auto-expands once when activity appears.
 *
 * The floater mounts in ui-layout's additive `shell.overlay`; it is not a
 * conversation node — the in-conversation panel was removed in favor of this
 * always-available monitor.
 *
 * ## 索菲亚移植点（**只有下面这几类**改动；UI 结构、类名、DOM 属性、文案键全未动）
 *
 * 1. **数据入口换掉**（改动之二）：上游原句是
 *    「polls the host `/plugins/dsh-agent-teams/state` route」—— 索菲亚没有那条路由。
 *    现在数据来自 `activity-monitor.ts` 的共享快照（它读索菲亚自己的
 *    `PanelStore`，见该文件头的对照表），组件层照旧用
 *    `useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)` 订阅
 *    —— **订阅方式一个字没改**，换掉的是快照的生产者。
 * 2. **props 形状**：`sessionsList` / `modelDirectories` 是**宿主服务**
 *    （会话列表服务、逐会话模型目录服务），索菲亚两半都没有这两个服务 ⇒ 换成
 *    `scope`（作用域）与 `modelDirectory`（单个目录，走 `bridge.ts` 的空目录桩）。
 *    逐条理由写在下方 `ActivityPanelProps` 上。
 * 3. **React 与 ui-primitives 改惰性取用**：上游是两条顶层值导入，
 *    而索菲亚的产物契约要求「插件注册期零 require」
 *    （`tests/shell.spec.ts` 用抛出型 `require` materialize `lib/client.js`）。
 *    手法与理由见 `../react-runtime.ts` 的文件头与 `../StagingPlanEditor.tsx` 的文件头。
 * 4. **头像素材换成索菲亚的**：`../panel/artwork.ts`（见那里的替换说明）。
 * 5. **剥掉卡片与宿主事件**（改动之三）：上游这里 `import { OPEN_PANEL_EVENT } from
 *    './AgentTeamsCard.tsx'`、并维护一份 `historic`（历史卡片投影）状态与
 *    `historicCardTeam()` 函数。索菲亚**没有**对话内嵌卡片、也没有
 *    `agent-teams:open-panel` 这个宿主窗口事件 ⇒ 整块剥除。**剥掉了什么、为什么、
 *    以及将来要恢复需要什么**，逐条写在原来那个 effect 的位置上
 *    （搜「索菲亚剥除」）。
 * 6. **两处 `useSyncExternalStore` 补了第 3 个参数**（服务端快照）：本仓的客户端
 *    用例全部走**服务端渲染**（`react-dom/server` 的 `renderToStaticMarkup`，
 *    见 `tests/client/panel.spec.tsx`），而 React 在 SSR 时**要求**
 *    `getServerSnapshot`，缺了会抛
 *    `Missing getServerSnapshot, which is required for server-rendered content.`
 *    （实测：React 18.3.1 + `renderToStaticMarkup`，2 参抛错 / 3 参正常返回
 *    `<span>1</span>`）。上游只传 2 个参数是因为它从不服务端渲染。
 *    ⇒ 两处都补上「与 `getSnapshot` 同一个读函数」的服务端快照：
 *    浏览器侧行为**不变**（客户端只用前两个参数），SSR 侧从抛错变成可渲染。
 * 7. **两处环境探针加固**（`initialPanelLayout` / `initialPanelBounds`）：上游只防
 *    「`window` 整个不存在」，而本仓用例装的是**空对象** `window = {}`
 *    （`tests/client/panel.spec.tsx:133`，文件级 `beforeEach`）⇒ `window.localStorage`
 *    是 `undefined`，`undefined.getItem` 会把 20 多处 SSG 断言当场打红。
 *    判据收紧为「`window` 在**且**该能力/维度可用」，缺则走上游自己给的默认值。
 *    逐条理由写在那两个函数上。**这两条都是"接线即炸"的真问题，不是推测**：
 *    探针实测 `Cannot read properties of undefined (reading 'getItem')`。
 *
 * ## 已知噪音（不是缺陷，但接线方应知道）
 *
 * 一次 SSG 渲染会往 `console.error` 打 **3 条**
 * `Warning: useLayoutEffect does nothing on the server, …`（3 个 `useLayoutEffect`
 * 调用点各一条，实测）。这是上游用 `useLayoutEffect` 的固有后果，**本文件保持原样**：
 * 想用 `typeof window === 'undefined'` 那种 isomorphic hint 消掉是**无效的** ——
 * 本仓测试里 `window` 是在场的（见上面第 7 条），判据不成立、警告照旧
 * （实测：加过该包装后仍是 3 条）。真要消掉，正确的层次是测试装载层 alias
 * `useLayoutEffect`。影响面已核实：`tests/client` 下无任何 console 洁净断言。
 *
 * @module dsh-agent-teams/client/activity
 *   （保留上游的 @module 标签：本文件是它那份的移植件，跟上游版本时靠这行对得上号。）
 */

// ⚠ 索菲亚移植点（React）：上游这里是**顶层值导入**
//   `import { useCallback, useEffect, …, useSyncExternalStore } from 'react'`。
// 顶层值导入会在插件**注册期**产生一次模块加载，被 `tests/shell.spec.ts` 的
// 「materialize 那一刻不得 require 任何东西」当场拒掉（实测 `Error: unexpected require react`）；
// 而 React 的实际取用时机在索菲亚由 `react-runtime.ts` 统一负责（完整取舍表见该文件头）。
// **类型**可以顶层 `import type`（会被完全擦除），**值**一律走下面的惰性入口。
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { react, type ReactFace } from '../../react-runtime.ts'

/**
 * 惰性 hook 的取用器。
 *
 * ## 为什么是「裸名函数」而不是 `../StagingPlanEditor.tsx` 那种 `React.useXxx` 代理
 *
 * 因为**被复制的这份上游文件是按裸名调用 hook 的**：`useState(false)` / `useEffect(…)` /
 * `useMemo(…)` / `useCallback(…)` / `useRef<…>(…)` … 每个组件的函数体里都是这个形状
 * （随手可核的一处：`:481-487` 一口气四个 `useState` + 一个 `useRef` + 一个 `useMemo`）。
 * 用代理就必须把**每一个调用点**逐个改成 `React.useState(...)`，
 * 而「整份复制、只改 import 路径与两类替换」这条纪律要求调用点尽量原样。
 * ⇒ 接缝放在**名字**上：这 7 个裸名在模块作用域被绑成惰性函数，调用点一个字不改。
 *
 * ⚠ 这里**故意不写每个 hook 的调用点数**：这个数字随数法而变（算不算注释里出现的
 * 名字、算不算 `useRef<…>(…)` 这种带泛型的写法），同一份文件我用两种数法得到的
 * 结果相差 10 以上 —— 写死一个数字等于给下一个人留一个对不上的坑。
 * 论证需要的是「改动面是全文件级，不是两三处」这个定性事实，不是那个数字。
 *   （上一版这里写了六个数（10/6/3/9/10/4），其中至少两个取的是**含注释**的口径、
 *    与下方第 6 条「两处 `useSyncExternalStore`」自相矛盾，已被第三方复核指出并删除。）
 *
 * ## 惰性的实现
 *
 * 每个名字是一个**转发函数**：真正取 `react()` 发生在**调用时**（即渲染期），
 * 而模块求值期只建函数对象、不碰 `require` ⇒ 注册期零 require 的契约不变。
 *
 * ⚠ 用 `(react()[name])(…)` 这种**属性访问后立即调用**的写法，而不是先取出来再调用：
 * 前者 `this` 是 React 模块命名空间（与直接调 `React.useState` 一致），
 * 后者 `this` 是 `undefined`。React 的 hook 不读 `this`，但正确性不该建立在
 * 「React 永远不用 this」这个未声明的前提上。
 *
 * ⚠ 这里的 `as ReactFace[K]` 是**实现体内部的**收窄：对外暴露的类型就是
 * `ReactFace[K]`（含 `useState` 的两个重载、`useSyncExternalStore` 的泛型与
 * 可选的 `getServerSnapshot`）⇒ 调用点仍受完整类型检查，写错参数照样报错。
 * 这与「用 `as never` 绕过检查」不是一回事：绕过的是**实现**，不是**接口**。
 */
function lazyHook<K extends keyof ReactFace>(name: K): ReactFace[K] {
  const forward = (...args: readonly unknown[]): unknown => {
    const face = react() as unknown as Record<string, (...inner: readonly unknown[]) => unknown>
    return (face[name] as (...inner: readonly unknown[]) => unknown)(...args)
  }
  return forward as unknown as ReactFace[K]
}

const useState = lazyHook('useState')
const useEffect = lazyHook('useEffect')
const useMemo = lazyHook('useMemo')
const useRef = lazyHook('useRef')
const useCallback = lazyHook('useCallback')
const useSyncExternalStore = lazyHook('useSyncExternalStore')

/**
 * ⚠ 这一条**保持上游原样**（就是真 `useLayoutEffect`），不改成「服务端退化成
 * `useEffect`」的那种 isomorphic hint —— 理由是一条**实测事实**，不是偏好：
 *
 * 那个 hint 的判据是 `typeof window === 'undefined'`，而本仓用例里 **`window` 是在场的**
 * （`tests/client/panel.spec.tsx:133` 的假 `window = {}`，为的是让 `apply` 能跑）。
 * ⇒ 判据不成立、分支不变，警告照旧出现。实测：加过那个包装之后重跑 SSG 探针，
 * `console.error` 仍是 **3 条**（每条对应一个 `useLayoutEffect` 调用点），
 * 所以那个包装**没有解决任何问题**，只是多了一层会让人误以为已解决的间接。
 *
 * 警告本身：`Warning: useLayoutEffect does nothing on the server, …`。
 * 影响面已核实 —— `tests/client` 下**没有**任何 console.error 计数/洁净断言
 * （全目录搜 `console.error` 零命中），所以它现在只是测试输出的噪音，
 * 不会打红断言。真要消掉，正确的层次是**测试装载层**去 alias `useLayoutEffect`
 * （React 官方对 SSR 包给的办法），而不是在这个文件里伪造一个判据。
 */
const useLayoutEffect = lazyHook('useLayoutEffect')

// ⚠ 索菲亚移植点（ui-primitives）：上游这里是**顶层值导入**
//   `import { IconBranchOutline16, …, Modal } from '@deepseek-ai/dsh-client-ui-primitives'`。
// 同一条「注册期零 require」纪律 ⇒ 走 `bridge.ts` 的**惰性代理**（同一个宿主模块、
// 同一批名字，只是把取用时机推到首次属性访问）。用法因此从 `<IconStopFill16 />`
// 变成 `<primitives.IconStopFill16 />`（JSX 的成员表达式），语义与 DOM 完全一致。
// ⚠ 这里**必须**复用 `bridge.ts` 已有的那一个代理，不要在本文件再取一次那个模块：
// `tests/client-sources.spec.ts:262` 在**产物文本**上数模块加载调用的出现次数
// （上限 2，实测当前恰好用满：`react-runtime.ts` 的惰性 react + `bridge.ts` 的这个代理）
// ⇒ 多写一处就是当场变红。
import { primitives, TEAM_HALT_AVAILABLE } from '../bridge.ts'
// 只需要 `ModelDirectory`（单个目录），不再需要 `ModelDirectoryResolver`（逐会话解析器）——
// 索菲亚没有「按会话取模型目录」这件事，见下方 props 说明。
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  activityPanelExpandedForSession,
  activityPanelShouldAutoExpand,
  compactDagLayout,
  compactModelLabel,
  COMPACT_DAG_NODE_HEIGHT,
  COMPACT_DAG_NODE_WIDTH,
  dependencyFocusTaskId,
  memberRouteLabel,
  relatedTaskIds,
  taskModelLabel,
  teamIsActive,
  usesParallelTaskGrid,
} from './activity-model.ts'
import {
  ACTIVITY_HALT_URL,
  getActivityMonitorTargetsSnapshot,
  getActivitySnapshotsSnapshot,
  startActivityPolling,
  subscribeActivityMonitorTargets,
  subscribeActivitySnapshots,
  type ActivityMember,
  type ActivitySource,
  type ActivityTask,
  type ActivityTeam,
} from './activity-monitor.ts'
import { ACTION_ART, LEAD_ART, memberArtUrl } from './artwork.ts'
import { StagingPlanEditor } from '../StagingPlanEditor.tsx'
// 建团模式那一行复用索菲亚面板既有的 `modeRow`/`modeLabel` 样式与 `data-sophia-mode` 口径
// （`styles.ts` 的 `PANEL_CSS` + `StagingDualPlanEditor.tsx:74-95`）—— 两处 UI 同源同形，
// 不在这里另造一套颜色/字号（主人：「外观照抄，别自己调」）。
import { CLASS } from '../../styles.ts'
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from '../locales.ts'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_STORAGE_KEY,
  compactPanelForBounds,
  dockPanelLayout,
  floatPanelLayout,
  movePanelLayout,
  panelMaximumHeight,
  panelUsesAutoHeight,
  parsePanelLayout,
  resizePanelLayout,
  resolvePanelGeometry,
  type PanelBounds,
  type PanelLayout,
  type PanelResizeEdge,
} from './panel-geometry.ts'
// ⚠ 索菲亚移植点（import 路径）：CSS 模块是**先前已经抄进来的那一份**
// （`src/client/vendor/ActivityPanel.module.css`，与 `panel.tsx` 共用同一个文件、
// 因此构建期的 tagId 相同 ⇒ 只会注入一个 `<style>`，不会重复注入两份样式）。
import css from '../ActivityPanel.module.css'

/** Grace before the panel collapses once no team remains. */
const AUTOCLOSE_GRACE_MS = 2000
/**
 * Page-settle window after mount: activity restored on page load only shows
 * the collapsed badge, so the panel never yanks the conversation column
 * right after load. New activity after this window auto-expands as usual.
 */
const AUTO_OPEN_SETTLE_MS = 4000
/** Root marker shared with the panel CSS while the shell overlay is expanded. */
const PANEL_OPEN_ATTRIBUTE = 'data-agent-teams-panel-open'
/** Shared width concession consumed by the conversation root CSS. */
const PANEL_SHIFT_PROPERTY = '--agent-teams-panel-shift'
const PANEL_CONVERSATION_GAP = 14
const MOVE_THRESHOLD = 4
const CAPTAIN_ASSIGNEE = 'captain'

type PanelGesture = {
  readonly kind: 'move' | 'resize'
  readonly edge?: PanelResizeEdge
  readonly pointerId: number
  readonly originX: number
  readonly originY: number
  readonly start: PanelLayout
  activated: boolean
}

/**
 * ⚠ 索菲亚移植点（SSR/测试环境加固）：上游这里是
 * `return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY))`。
 *
 * 上游只防了「`window` 整个不存在」，**没防「`window` 在、但 `localStorage` 不在」**。
 * 而本仓的用例恰恰是那种环境：`tests/client/panel.spec.tsx:162` 的**文件级**
 * `beforeEach` 每次都装一个 `globals.window = {}`（`panel.spec.tsx:133`，
 * 故意只有空对象，因为 `apply` 只需要 `window` 在场），而同一个文件里 20 多处
 * 用 `renderToStaticMarkup` 渲染面板 —— 那些断言全在这个 `beforeEach` 之下。
 * ⇒ 一旦把本组件接进 `panel.tsx`，`typeof window === 'undefined'` 为**假**、
 * 于是读 `undefined.getItem` 当场 `TypeError: Cannot read properties of undefined
 * (reading 'getItem')`，把那一整批既有断言打红。
 * 实测：把本组件接进气口图后跑 SSG，就是这个报错（探针复现，见交付报告）。
 *
 * 修法是 `?.` + `?? null`：**缺 localStorage 与没有存过值走同一条路**
 * （`parsePanelLayout(null)` → `DEFAULT_PANEL_LAYOUT`），语义不变、环境适应性变对。
 */
function initialPanelLayout(): PanelLayout {
  if (typeof window === 'undefined') return DEFAULT_PANEL_LAYOUT
  return parsePanelLayout(window.localStorage?.getItem(PANEL_LAYOUT_STORAGE_KEY) ?? null)
}

/**
 * ⚠ 索菲亚移植点（SSR/测试环境加固）：同上 —— 上游只判了「`window` 不存在」，
 * 而假 `window = {}` 下 `window.innerWidth` 是 `undefined`，会算出
 * `{ width: undefined, … }` 并经 `resolvePanelGeometry` 变成 `NaN` 样式值。
 * 不抛错，但会让 SSG 产物里出现 `width:NaNpx` 这种垃圾。
 * ⇒ 把判据从「window 在不在」收紧成「window 在**且**那两个维度是数字」，
 * 缺任何一条就退回上游自己给的默认值（1440×900）。
 */
function initialPanelBounds(): PanelBounds {
  if (typeof window === 'undefined' || typeof window.innerWidth !== 'number' || typeof window.innerHeight !== 'number') {
    return { width: 1440, height: 900, anchorRight: 1440 }
  }
  return { width: window.innerWidth, height: window.innerHeight, anchorRight: window.innerWidth }
}

/** Initial-letter fallback for unmatched roles. */
function memberInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

const ACCENTS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-error-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-label-tertiary)',
] as const

function accentOf(id: string): string {
  return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0]
}

/** Badge text follows the raw task status (finer than the 4 visual states):
 * claimed/pending/failed/cancelled keep their own labels and colors. */
const TASK_STATUS_LABEL: Record<string, AgentTeamsLocaleKey> = {
  pending: 'task.status.pending',
  claimed: 'task.status.claimed',
  in_progress: 'task.status.inProgress',
  completed: 'task.status.completed',
  failed: 'task.status.failed',
  cancelled: 'task.status.cancelled',
}

function taskStatusLabel(status: string, t: AgentTeamsTranslate): string {
  const key = TASK_STATUS_LABEL[status]
  return key === undefined ? status : t(key)
}

function formatTaskIds(ids: readonly string[], t: AgentTeamsTranslate): string {
  return ids.join(t('format.listSeparator'))
}

function taskTitle(task: ActivityTask, model: string): string {
  const extras = [
    task.kind,
    task.round === undefined ? undefined : `r${task.round}`,
    task.verdict,
    model === '' ? undefined : model,
  ].filter((item): item is string => item !== undefined)
  return extras.length === 0 ? `${task.id} · ${task.subject}` : `${task.id} · ${task.subject} · ${extras.join(' · ')}`
}

/** Badge/bar coloring key: visual state, widened for terminal statuses. */
function taskTone(state: ActivityTask['state'], status: string): string {
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return state
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg className={css.chevron} data-open={open} width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  )
}

function WorkGlyph({ active }: { readonly active: boolean }) {
  return (
    <svg className={css.workGlyph} data-active={active} width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden>
      {[[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]].map(([x, y], index) => (
        <rect key={`${x}:${y}`} x={x} y={y} width="2.6" height="2.6" rx=".6" style={{ animationDelay: `${index * 0.15}s` }} />
      ))}
    </svg>
  )
}

/** Collapsed badge: an always-visible corner pill while any team exists. */
function CollapsedBadge({ count, busy, onClick, t }: {
  readonly count: number
  readonly busy: boolean
  readonly onClick: () => void
  readonly t: AgentTeamsTranslate
}) {
  return (
    <button type="button" className={css.badge} data-agent-teams-collapsed data-busy={busy} onClick={onClick} aria-label={t('activity.badgeAria', { count })}>
      <span className={css.badgeDot} data-busy={busy} aria-hidden />
      <span className={css.badgeCount}>{count}</span>
    </button>
  )
}

function memberStateLabel(
  member: ActivityMember,
  tasks: readonly ActivityTask[],
  historic: boolean,
  t: AgentTeamsTranslate,
): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  if (member.activity === 'working') return t('member.state.working')
  if (owned.some((task) => task.status === 'failed')) return t('member.state.failed')
  if (owned.some((task) => task.state === 'blocked')) return t('member.state.waiting')
  if (owned.length > 0 && owned.every((task) => task.status === 'completed')) return t('member.state.delivered')
  if (member.status === 'removed') return t(historic ? 'member.state.left' : 'member.state.removed')
  if (owned.length > 0) return t('member.state.pending')
  return t('member.state.unassigned')
}

function memberStatusText(
  member: ActivityMember,
  tasks: readonly ActivityTask[],
  t: AgentTeamsTranslate,
): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  const current = owned.find((task) => task.id === member.currentTask)
  const blocked = owned.find((task) => task.state === 'blocked')
  if (member.activity === 'working' && current !== undefined) {
    const model = taskModelLabel(current, [member])
    return model === ''
      ? t('member.status.executing', { taskId: current.id })
      : t('member.status.executingModel', { taskId: current.id, model })
  }
  if (member.activity === 'working') return t('member.status.working')
  if (blocked !== undefined) {
    const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== 'completed')
    if (dependency !== undefined) {
      return t('member.status.waitingOn', {
        taskId: dependency.id,
        assignee: dependency.assignee || t('task.assignee.unclaimed'),
      })
    }
    return t('member.status.waitingPrerequisite')
  }
  if (member.total === 0) return t('member.status.waitingAssignment')
  if (member.done === member.total) return t('member.status.delivered')
  return t(member.activity === 'idle' ? 'member.status.idle' : 'member.status.unknown')
}

function compactTaskLabel(subject: string): string {
  const withoutVerb = subject.replace(/^开发\s*/u, '').replace(/^\d+[-_.、\s]*/u, '')
  const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb
  return head.length > 18 ? `${head.slice(0, 17)}…` : head
}

function taskSummary(team: ActivityTeam, t: AgentTeamsTranslate, discarded = false): string {
  const completed = team.tasks.filter((task) => task.status === 'completed')
  const cancelled = team.tasks.filter((task) => task.status === 'cancelled')
  const running = team.tasks.filter((task) => task.state === 'running')
  const blocked = team.tasks.filter((task) => task.state === 'blocked')
  const ready = team.tasks.filter((task) => task.state === 'open' && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')
  const failed = team.tasks.filter((task) => task.status === 'failed')
  if (discarded) return t('task.summary.discarded', { count: team.tasks.length })
  if (team.tasks.length === 0) return t('task.summary.waitingBreakdown')
  if (team.phase === 'staged') return t('task.summary.staged', { count: team.tasks.length })
  if (completed.length === team.tasks.length) return t('task.summary.allDelivered', { count: completed.length })
  if (completed.length + cancelled.length + failed.length === team.tasks.length) {
    return t('task.summary.ended', {
      completed: completed.length,
      cancelled: cancelled.length,
      failed: failed.length,
    })
  }
  if (failed.length > 0 && running.length === 0 && ready.length === 0 && blocked.length === 0) {
    return t('task.summary.failedSettled', { count: failed.length })
  }
  if (blocked.length > 0 && running.length > 0) {
    return t('task.summary.blockedAndRunning', {
      tasks: formatTaskIds(blocked.slice(0, 3).map((task) => task.id), t),
      more: blocked.length > 3 ? t('task.summary.more', { count: blocked.length - 3 }) : '',
    })
  }
  if (running.length > 0) return t('task.summary.running', { tasks: formatTaskIds(running.map((task) => task.id), t) })
  if (ready.length > 0) return t('task.summary.ready', { tasks: formatTaskIds(ready.map((task) => task.id), t) })
  if (blocked.length > 0) return t('task.summary.blocked', { tasks: formatTaskIds(blocked.map((task) => task.id), t) })
  return t('task.summary.waitingSchedule')
}

function ProgressOverview({ team, t, discarded = false }: { readonly team: ActivityTeam; readonly t: AgentTeamsTranslate; readonly discarded?: boolean }) {
  const running = discarded ? 0 : team.tasks.filter((task) => task.state === 'running').length
  const blocked = discarded ? 0 : team.tasks.filter((task) => task.state === 'blocked').length
  const completed = discarded ? 0 : team.tasks.filter((task) => task.status === 'completed').length
  const settled = !discarded && team.tasks.length > 0 && team.tasks.every((task) => (
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
  ))
  const summaryTone = discarded ? 'discarded' : blocked > 0 ? 'warning' : settled ? 'completed' : 'running'
  return (
    <section className={css.progressOverview} aria-label={t('progress.aria')} data-progress-summary>
      <span className={css.progressTitle}>{t('progress.title')}</span>
      {team.tasks.length > 0 ? (
        <span className={css.progressSegments} aria-hidden>
          {team.tasks.map((task) => <span key={task.id} data-state={discarded ? 'cancelled' : taskTone(task.state, task.status)} />)}
        </span>
      ) : <span className={css.progressEmpty} />}
      <span className={css.progressLegend}>
        <span data-state="running">{t('progress.running', { count: running })}</span>
        <span data-state="blocked">{t('progress.blocked', { count: blocked })}</span>
        <span data-state="completed">{t('progress.delivered', { count: completed })}</span>
      </span>
      <span className={css.progressSummary} data-state={summaryTone}>
        <span className={css.progressSummaryDot} />
        <span>{taskSummary(team, t, discarded)}</span>
      </span>
    </section>
  )
}

function DependencyMap({ tasks, members, t, discarded = false }: {
  readonly tasks: readonly ActivityTask[]
  readonly members: readonly ActivityMember[]
  readonly t: AgentTeamsTranslate
  readonly discarded?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null)
  const [keyboardTaskId, setKeyboardTaskId] = useState<string | null>(null)
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId)
  const layout = useMemo(() => compactDagLayout(tasks), [tasks])
  const parallel = useMemo(() => usesParallelTaskGrid(tasks), [tasks])
  const related = useMemo(
    () => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks),
    [focusedTaskId, tasks],
  )
  const scheduleHover = (id: string | null): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    if (id === null) {
      setHoverTaskId(null)
      return
    }
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null
      setHoverTaskId(id)
    }, 180)
  }
  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinnedTaskId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])
  if (tasks.length === 0) return null
  const fallbackTask = tasks.find((task) => task.state === 'blocked')
    ?? tasks.find((task) => task.state === 'running')
    ?? tasks[0]!
  const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask
  const detailModel = taskModelLabel(detailTask, members)
  const waitingOn = detailTask.dependencies.filter((dependency) => (
    tasks.find((task) => task.id === dependency)?.status !== 'completed'
  ))
  const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id))
  return (
    <section className={css.dependencySection} aria-label={t('dependency.aria')} data-dependency-map>
      <header className={css.sectionHead}>
        <button type="button" className={css.sectionToggleTitle} onClick={() => { setOpen((current) => !current) }} aria-expanded={open}>
          <Chevron open={open} /><primitives.IconBranchOutline16 /> {t(parallel ? 'dependency.parallel' : 'dependency.title')}
        </button>
        <span className={css.sectionHint}>{pinnedTaskId === null
          ? t(parallel ? 'dependency.hint.parallel' : 'dependency.hint.chain')
          : t('dependency.hint.pinned', { taskId: pinnedTaskId })}</span>
      </header>
      {open && (
        <>
          <div className={css.dagViewport}>
            <div
              className={css.dagCanvas}
              data-layout={parallel ? 'parallel' : 'dependency'}
              style={parallel ? undefined : { width: layout.width, height: layout.height }}
            >
              {!parallel && <svg className={css.dagEdges} width={layout.width} height={layout.height} aria-hidden>
                {layout.edges.map((edge) => {
                  const active = related !== null && related.has(edge.from) && related.has(edge.to)
                  return <path key={`${edge.from}:${edge.to}`} d={edge.path} data-active={active} data-dimmed={related !== null && !active} />
                })}
              </svg>}
              {layout.nodes.map(({ task, x, y }) => {
                const model = taskModelLabel(task, members)
                const shortModel = compactModelLabel(model)
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={css.dagNode}
                    style={parallel
                      ? { height: COMPACT_DAG_NODE_HEIGHT }
                      : { left: x, top: y, width: COMPACT_DAG_NODE_WIDTH, height: COMPACT_DAG_NODE_HEIGHT }}
                    data-task-id={task.id}
                    data-state={discarded ? 'cancelled' : taskTone(task.state, task.status)}
                    data-task-model={model || undefined}
                    data-focused={related?.has(task.id) ?? false}
                    data-dimmed={related !== null && !related.has(task.id)}
                    aria-pressed={pinnedTaskId === task.id}
                    title={taskTitle(task, model)}
                    onClick={() => { setPinnedTaskId((current) => current === task.id ? null : task.id) }}
                    onMouseEnter={() => { scheduleHover(task.id) }}
                    onMouseLeave={() => { scheduleHover(null) }}
                    onFocus={() => { setKeyboardTaskId(task.id) }}
                    onBlur={() => { setKeyboardTaskId(null) }}
                  >
                    <span className={css.dagNodeHead}><span className={css.dagNodeDot} />{task.id}</span>
                    <span className={css.dagNodeLabel}>
                      {task.state === 'running' && shortModel !== '' ? shortModel : compactTaskLabel(task.subject)}
                    </span>
                    {task.state === 'running' && (
                      <span className={css.dagRunningState} aria-label={t('task.runningAria')}>
                        <WorkGlyph active />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          <section className={css.taskDetail} data-task-detail={detailTask.id}>
            <span className={css.taskDetailHead}>
              <span className={css.taskDetailId}>{detailTask.id}</span>
              <span className={css.taskDetailSubject} title={detailTask.subject}>{detailTask.subject.replace(/^开发\s*/u, '')}</span>
              <span className={css.taskDetailBadge} data-state={discarded ? 'cancelled' : taskTone(detailTask.state, detailTask.status)}>
                {discarded ? t('task.status.notRun') : taskStatusLabel(detailTask.status, t)}
              </span>
            </span>
            <span className={css.taskDetailLine}>
              {detailTask.assignee || t('task.assignee.unclaimed')} · {discarded
                ? t('task.detail.notRun')
                : detailTask.status === 'completed'
                ? t('task.detail.completed')
                : detailTask.dependencies.length === 0
                ? t('task.detail.noPrerequisite')
                : waitingOn.length === 0
                  ? t('task.detail.ready')
                  : t('task.detail.waitingOn', { tasks: formatTaskIds(waitingOn, t) })}
            </span>
            {detailModel !== '' && (
              <span className={css.taskDetailModel} data-task-model={detailModel}>
                {t('task.model', { model: detailModel })}
              </span>
            )}
            <span className={css.taskDetailMeta}>{dependents.length === 0
              ? t('task.detail.noDownstream')
              : t('task.detail.unlocks', { tasks: formatTaskIds(dependents.map((task) => task.id), t) })}</span>
          </section>
        </>
      )}
    </section>
  )
}

function TeamSection({ team, modelDirectory, onContinuePlanning, onDiscarded, onPlanAction, onNavigate, planMode, t, historic = false }: {
  readonly team: ActivityTeam
  /**
   * 模型目录；缺省（或显式 `undefined`）时不渲染计划编辑器。
   *
   * ⚠ 索菲亚移植点：上游写的是 `readonly modelDirectory?: ModelDirectory`。
   * 本包开了 `exactOptionalPropertyTypes`，那种写法**不接受显式传 `undefined`**
   * （TS2375）；而调用点（`ActivityPanel` 的 `visibleTeams.map`）恰恰要用
   * `team.phase === 'staged' ? modelDirectory : undefined` 这个三元表达式来表达
   * 「非拟建态就不给目录」—— 那是上游原有的写法，不该为了迁就类型而改写逻辑。
   * ⇒ 按本仓约定把可选属性写成 `?: T | undefined`（仓库里 `upstream-modules.d.ts`
   * 的文件头专门记过这条「本仓与上游的真实差异」）。
   */
  readonly modelDirectory?: ModelDirectory | undefined
  readonly onContinuePlanning?: () => void
  readonly onDiscarded?: () => void
  /**
   * 索菲亚移植点（可选，上游没有）：透传给 `StagingPlanEditor` 的写动作覆盖点。
   * 提供它 ⇒ 拟建团的「确认并启动团队 / 放弃本次计划」走索菲亚的真实契约
   * （`POST /api/sophia/spawn/decision`），而不是上游的
   * `{sessionId, teamId, action}` 载荷（索菲亚宿主没有那几个字段，必 400 ——
   * 2026-09-24 主人实测「确认不了也取消不了」的病根）。缺省 = 上游原样。
   */
  readonly onPlanAction?: ((action: 'approve' | 'discard', requestId: string) => Promise<void>) | undefined
  /** Navigate to a member transcript (floater hides immediately).
   *  ⚠ 索菲亚移植点：上游的入参是宿主的 `SessionId`；索菲亚没有会话维度，
   *  两个入参都是 `string`（作用域 + 成员 id），与 `ActivityPanelProps.openMember` 一致。 */
  readonly onNavigate: (scope: string, memberId: string) => void
  /**
   * 建团模式单选的**唯一状态源**（索菲亚新增，上游没有）。
   *
   * ⚠ 这里**不存状态**：只读 `value(teamId)` / 写 `onChange(teamId, mode)`。
   *   两个 UI（本面板的拟建团块 + 索菲亚面板的审批卡）若各自 `useState`，
   *   就会出现「两处各存一份、显示还不一样」—— 所以状态归调用方（`panel.tsx`）
   *   所有，本组件只是它的一支显示与输入。缺省 = 不渲染这一行。
   */
  readonly planMode?: PlanModeControl | undefined
  readonly t: AgentTeamsTranslate
  readonly historic?: boolean
}) {
  const [membersOpen, setMembersOpen] = useState(true)
  const [stopOpen, setStopOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  const discarded = historic && team.phase === 'staged'
  const stopped = !historic && team.halted === true
  const busyCount = team.members.filter((member) => member.activity === 'working').length
  const assignedCount = team.tasks.filter((task) => task.assignee !== '' && task.assignee !== CAPTAIN_ASSIGNEE).length
  const captainOwned = team.tasks.filter((task) => task.assignee === CAPTAIN_ASSIGNEE
    && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')
  const captainBusy = captainOwned.length > 0
  const captainTaskIds = formatTaskIds(captainOwned.map((task) => task.id), t)
  const completedCount = team.tasks.filter((task) => task.status === 'completed').length
  const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length
  const allSettled = team.tasks.length > 0 && team.tasks.every((task) => (
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
  ))
  const unfinishedCount = team.tasks.filter((task) => (
    task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled'
  )).length
  const canStop = !historic && team.phase === 'running' && team.halted !== true && teamIsActive(team)
  const stopTeam = async (): Promise<void> => {
    if (stopping) return
    // ⚠ 索菲亚移植点（禁用态）：宿主半还没有**团队级中止**路由
    //   （判据与理由见 `bridge.ts` 的 `TEAM_HALT_AVAILABLE`）。
    // 这边**根本不发请求**：发出去只会得到 404，再被上游的错误分支渲染成
    // 「服务器未能停止团队，请重试」—— 那句话是误导（不是"暂时不行"，是"没有这功能"，
    // 重试永远不会好）。⇒ 改为把原因原样显示在弹窗里。
    // 这一行是「不发请求」的唯一守门点：就算将来有人把确认键的 `disabled` 摘掉，
    // 也不会退化成打 404（`grep TEAM_HALT_AVAILABLE` 能把这个开关的所有判据找全）。
    if (!TEAM_HALT_AVAILABLE) {
      setStopError(t('team.stopUnavailableDetail'))
      return
    }
    setStopping(true)
    setStopError('')
    try {
      const response = await fetch(ACTIVITY_HALT_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: team.captainSessionId, teamId: team.teamId }),
      })
      if (!response.ok) {
        let message = t('team.stopRequestFailed')
        try {
          const body = await response.json() as { error?: unknown }
          if (typeof body.error === 'string' && body.error.trim() !== '') message = body.error
        } catch {}
        throw new Error(message)
      }
      setStopOpen(false)
    } catch (error: unknown) {
      setStopError(t('team.stopFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setStopping(false)
    }
  }
  return (
    <>
      <section className={css.team} data-team-id={team.teamId}>
        <header className={css.teamHead}>
          <span className={css.teamName} title={team.name}>{team.name}</span>
          {historic && <span className={css.historicPill}>{t(discarded ? 'team.discarded' : 'team.ended')}</span>}
          {stopped && <span className={css.historicPill}>{t('team.stopped')}</span>}
          <span className={css.teamStats}>
            <span data-stat="members">{t('team.stats.members', { count: team.members.length })}</span>
            <span data-stat="tasks">{t('team.stats.completed', { completed: completedCount, total: team.tasks.length })}</span>
            <span data-stat="messages">{t('team.stats.messages', { count: team.messageCount })}</span>
          </span>
          {canStop && (
            <button
              type="button"
              className={css.teamStopButton}
              // `aria-label` 保持上游的无障碍名（"停止团队"），额外信息走 `title`：
              // 无障碍名是"这是什么按钮"，不该被"当前不可用"污染。
              aria-label={t('team.stop')}
              // ⚠ 索菲亚移植点（禁用态）：宿主没有团队级中止路由时
              // ① 按钮**照旧渲染**（不删 = 不把"为什么没有"藏起来），
              // ② `title` 换成写明原因的那句（悬停即可读），
              // ③ `data-halt-unavailable` 是给机器读的可核锚点（与面板的其它 `data-*` 同款，
              //    测试/诊断可据此断言"禁用态真的生效了"，而不是靠肉眼看样式）。
              data-halt-unavailable={!TEAM_HALT_AVAILABLE}
              title={TEAM_HALT_AVAILABLE ? t('team.stop') : t('team.stopUnavailable')}
              onClick={() => { setStopError(''); setStopOpen(true) }}
            >
              <primitives.IconStopFill16 />
            </button>
          )}
        </header>

        {team.phase === 'staged' && !historic && modelDirectory !== undefined && onContinuePlanning !== undefined && onDiscarded !== undefined && (
          <>
            {/* ── 索菲亚新增（主人点名的缺口）：「建团模式」单选 ──────────────────
                主人原话：「这个UI它**少了那个选模式**。你得把它那个选模式功能做上去，UI也做上去。」

                位置：**在 `确认并启动团队` 之上** —— 那个按钮在 `StagingPlanEditor` 的确认行里
                （`StagingPlanEditor.tsx:799` 的 `planApproveRow` / `:829` 的 `data-plan-approve`），
                所以这里把单选渲染在编辑器**之前** —— 用户读完计划、按下确认之前一定先看到它。

                属性口径与索菲亚面板另一处（`StagingDualPlanEditor.tsx:80/90`）**逐字一致**：
                `data-sophia-mode="persistent-team"` / `"dag-scheduler"`，选项文案同一个
                `t('modePersistent')` / `t('modeDag')`（`locales.ts:160-161`）——
                两处 UI 不会一边一个说法。

                ⚠ 为什么不用活动面板自己的 CSS 类：这一行**上游没有**（上游没有模式选择），
                而它要与之「看起来是一套」的那一处在索菲亚自己的面板里用
                `CLASS.modeRow`/`CLASS.modeLabel`（`styles.ts`）⇒ 直接复用同一组类，
                比在这里另造一套颜色/字号更接近主人的要求（「外观照抄，别自己调」）。 */}
            {planMode === undefined
              ? null
              : (
                  <div className={CLASS.modeRow} data-sophia-mode-row={team.teamId}>
                    <span className={CLASS.modeLabel}>{planMode.label}：</span>
                    <label>
                      <input
                        type="radio"
                        name={`sophia-mode-${team.teamId}`}
                        data-sophia-mode="persistent-team"
                        checked={planMode.value(team.teamId) === 'persistent'}
                        onChange={() => { planMode.onChange(team.teamId, 'persistent') }}
                      />
                      {' '}{planMode.persistentLabel}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`sophia-mode-${team.teamId}`}
                        data-sophia-mode="dag-scheduler"
                        // ⚠ DAG 调度链路在本版**没有实现**（阶段 3）⇒ 诚实禁用 + 写明原因，
                        //   不许做成「能点、点了没后果」（那比禁用更坏，会谎报选择有后果）。
                        disabled
                        title={planMode.dagLabel}
                      />
                      {' '}{planMode.dagLabel}
                    </label>
                  </div>
                )}
            <StagingPlanEditor
              team={team}
              modelDirectory={modelDirectory}
              onContinuePlanning={onContinuePlanning}
              onDiscarded={onDiscarded}
              {...(onPlanAction === undefined ? {} : { onPlanAction })}
              t={t}
            />
          </>
        )}

      <section className={css.delegationSection} aria-label={t('delegation.aria')} data-delegation-map>
        <div className={css.captainNode}>
          <span className={css.captainAvatar}>
            <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
          </span>
          <span className={css.captainInfo}>
            <span className={css.captainLine}>
              <span className={css.captainName}>{t('captain.name')}</span>
              <span className={css.captainRole}>{t('captain.role')}</span>
            </span>
            <span className={css.captainSummary}>{discarded
              ? t('captain.summary.discarded', { tasks: team.tasks.length, members: team.members.length })
              : captainBusy
                ? t('captain.summary.withTakeover', { tasks: assignedCount, captainTasks: captainTaskIds })
              : team.phase === 'staged'
                ? t(team.planReviewState === 'awaiting_feedback'
                  ? 'captain.summary.awaitingFeedback'
                  : 'captain.summary.staged', { tasks: team.tasks.length, members: team.members.length })
                : t('captain.summary', { tasks: assignedCount, members: team.members.length })}</span>
          </span>
          <span className={css.captainState} data-busy={captainBusy || busyCount > 0}>
            <WorkGlyph active={captainBusy || busyCount > 0} />
            {discarded
              ? t('captain.state.discarded')
              : captainBusy
                ? t('captain.state.takeover', { tasks: captainTaskIds })
              : team.phase === 'staged'
                ? t(team.planReviewState === 'awaiting_feedback'
                  ? 'captain.state.awaitingFeedback'
                  : 'captain.state.staged')
              : busyCount > 0
                ? t('captain.state.working', { count: busyCount })
                : t(allCompleted
                  ? 'captain.state.collected'
                  : allSettled
                    ? 'captain.state.settled'
                    : 'captain.state.waiting')}
          </span>
        </div>

        <ProgressOverview team={team} t={t} discarded={discarded} />

        <button type="button" className={css.membersToggle} onClick={() => { setMembersOpen((current) => !current) }} aria-expanded={membersOpen} data-members-toggle>
          <span><Chevron open={membersOpen} />{t('members.toggle', { count: team.members.length })}</span>
          <span>{t(membersOpen ? 'members.collapse' : 'members.expand')}</span>
        </button>

        {membersOpen && <div className={css.delegationTree}>
          {team.members.length === 0 && <span className={css.emptyHint}>{t('members.empty')}</span>}
          {team.members.map((member) => {
            const owned = team.tasks.filter((task) => task.assignee === member.name)
            const memberModel = memberRouteLabel(member)
            // ⚠ 索菲亚移植点（改动之二·头像）：上游这里调 `memberArtUrl(member.name, member.role)`
            // **两遍**（先判空、再取 src）。索菲亚的判据是宿主的 `avatarPath`（见 artwork.ts
            // 的三条理由），所以入参从「名字 + 角色」换成成员本身，并在这里只算一次 ——
            // 两次调用若取值不同（中间插了一次重渲染、读到新数据），会画出
            // 「判空走有图分支、src 却是空串」的破图元素。
            const memberArt = memberArtUrl(member)
            const actionArt = ACTION_ART[member.activity]
            return (
              <div key={member.id || member.name} className={css.memberBlock} data-activity={member.activity}>
                <span className={css.memberBranch} aria-hidden><span /></span>
                <button
                  type="button"
                  className={css.memberRow}
                  data-activity={member.activity}
                  onClick={() => {
                    if (member.id !== '') {
                      // ⚠ 索菲亚移植点：上游这里把两个 id 断言成 `SessionId`（宿主会话品牌类型）。
                      // 索菲亚的成员 id 是 `sophia-<职位slug>-<uuid8>`（`naming.ts` 的不透明标识），
                      // 团也没有会话维度 ⇒ 一律按 `string` 传递，不套一个索菲亚并不存在的品牌类型。
                      onNavigate(team.captainSessionId, member.id)
                    }
                  }}
                >
                  <span className={css.memberAvatar} data-unread={member.unread > 0}>
                    {memberArt !== null ? (
                      <img className={css.memberArt} src={memberArt} alt="" aria-hidden />
                    ) : (
                      <span className={css.memberInitial} style={{ background: accentOf(member.id) }}>{memberInitial(member.name)}</span>
                    )}
                    {/* ⚠ 索菲亚移植点：上游无条件渲染这张状态动作插画。
                        索菲亚**没有**这套素材（实测盘点见 artwork.ts 的 `ACTION_ART`）
                        ⇒ 三项都是 `null`，这里据实**不渲染**这个 `<img>`，
                        而不是给一个 `src=""` 的破图元素（那看起来像加载失败）。
                        `css.stateArt` 规则与 `data-activity` 语义都留在 CSS/上游结构里：
                        素材一到（把 `ACTION_ART` 的某项从 `null` 改成 URL）这张图立刻复活。 */}
                    {actionArt !== null && (
                      <img className={css.stateArt} data-activity={member.activity} src={actionArt} alt="" aria-hidden />
                    )}
                  </span>
                  <span className={css.memberInfo}>
                    <span className={css.memberLine}>
                      <span className={css.memberName}>{member.name}</span>
                      {member.role !== '' && <span className={css.memberRole}>{member.role}</span>}
                      {/* Inline member model badge: compact visible label, full route in
                          title/aria-label (accessible tooltip) and the data-member-model
                          DOM probe; noninteractive span, no tab stop. */}
                      {memberModel !== '' && (
                        <span className={css.memberModel} role="img" data-member-model={memberModel} title={memberModel} aria-label={memberModel}>
                          {compactModelLabel(memberModel)}
                        </span>
                      )}
                      <span className={css.memberState} data-activity={member.activity}>
                        <WorkGlyph active={member.activity === 'working'} />
                        {discarded
                          ? t('member.state.notCreated')
                          : stopped
                            ? t('member.state.stopped')
                            : team.phase === 'staged'
                              ? t('member.state.staged')
                              : memberStateLabel(member, team.tasks, historic, t)}
                      </span>
                    </span>
                    <span className={css.memberStatusLine}>{discarded
                      ? t('member.status.discarded')
                      : stopped
                        ? t('member.status.stopped')
                        : team.phase === 'staged'
                          ? t('member.status.staged')
                      : historic && owned.length > 0 && owned.every((task) => (
                        task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
                      ))
                        ? t('member.status.settled')
                      : memberStatusText(member, team.tasks, t)}</span>
                  </span>
                  <span className={css.memberCount}>{member.done}/{member.total}</span>
                </button>
                <div className={css.assignmentLine}>
                  <span className={css.assignmentLabel}>{t(discarded
                    ? 'assignment.discarded'
                    : team.phase === 'staged'
                      ? 'assignment.staged'
                      : 'assignment.label')}</span>
                  <span className={css.assignmentTasks}>
                    {owned.length === 0
                      ? <span className={css.taskEmpty}>{t('assignment.empty')}</span>
                      : owned.map((task) => {
                          const model = taskModelLabel(task, team.members)
                          const shortModel = compactModelLabel(model)
                          return (
                            <span
                              key={task.id}
                              className={css.assignmentChip}
                              data-state={discarded ? 'cancelled' : taskTone(task.state, task.status)}
                              data-task-model={model || undefined}
                              title={taskTitle(task, model)}
                            >
                              {task.state === 'running' && shortModel !== '' ? `${task.id} · ${shortModel}` : task.id}
                            </span>
                          )
                        })}
                  </span>
                </div>
              </div>
            )
          })}
        </div>}
      </section>

      <DependencyMap tasks={team.tasks} members={team.members} t={t} discarded={discarded} />
      </section>
      <primitives.Modal
        open={stopOpen}
        onClose={() => { if (!stopping) setStopOpen(false) }}
        title={t('team.stopTitle', { team: team.name })}
        closeLabel={t('plan.cancel')}
        description={t('team.stopDescription', { tasks: unfinishedCount, members: busyCount })}
        footer={(
          <span className={css.stopModalActions}>
            <button type="button" disabled={stopping} onClick={() => { setStopOpen(false) }}>{t('team.stopCancel')}</button>
            <button
              type="button"
              data-danger
              // ⚠ 索菲亚移植点（禁用态）：宿主没有团队级中止路由时，确认键**永久禁用**
              //（不是"正在停止"——那个状态是 `stopping` 的活）。配合上面的
              // `stopTeam` 守门点，这条路由一次请求都不会收到。
              data-halt-unavailable={!TEAM_HALT_AVAILABLE}
              disabled={stopping || !TEAM_HALT_AVAILABLE}
              onClick={() => { void stopTeam() }}
            >
              <primitives.IconStopFill16 />
              {stopping ? t('team.stopping') : t('team.stopConfirm')}
            </button>
          </span>
        )}
      >
        {/* ⚠ 索菲亚移植点（禁用态）：把"为什么不能停"写在弹窗正文里（可见文本，
            不是只挂在 tooltip 上 —— 灰一个没有解释的按钮正是要避免的那种做法）。
            `role="status"`：它是说明，不是错误告警（错误那条仍用 `role="alert"`）。 */}
        {!TEAM_HALT_AVAILABLE && (
          <p className={css.stopModalUnavailable} data-halt-unavailable role="status">
            {t('team.stopUnavailableDetail')}
          </p>
        )}
        {stopError !== '' && <p className={css.stopModalError} role="alert"><primitives.IconWarningOutline16 />{stopError}</p>}
      </primitives.Modal>
    </>
  )
}

/** The top-right activity floater. Live snapshots are shown while their scope
 * is the one currently open. */
export type ActivityPanelProps = {
  readonly conversationVisible?: boolean
  /**
   * 当前作用域。
   *
   * ⚠ 索菲亚移植点（数据入口）：上游这里是一个**宿主服务**
   * `sessionsList: ObservableSnapshot<SessionListState>`（会话列表），面板从它的
   * `getSnapshot().current` 取「当前 captain 会话」，再据此过滤「哪些团属于本会话」。
   *
   * 索菲亚没有这个服务，也**没有会话维度**：`src/client/index.ts` 的 client 半
   * 只声明了 `inject: ['slots']`，而团一律不绑会话
   * （`adapters/activity.ts` 的 `captainSessionId: ''`，那里写明了这是与上游的根本分歧）。
   *
   * ⇒ 换成一个直接的作用域值：
   * - 索菲亚接线时传 `''`（= 本账本视图，与适配层写出的 `captainSessionId` 同值）；
   * - 传 `undefined` 会**照上游语义**什么都不显示（上游用它表达「还没选中会话」）——
   *   之所以保留这一支而不是把 `''` 当默认值，是因为「静默默认」正是这类接线最常见的
   *   失效模式：父 agent 少传一个 prop 时，界面会安静地什么都不画，看不出是漏传。
   *   必填 ⇒ 少传会当场 `TS2741`。
   */
  readonly scope: string | undefined
  /**
   * 模型目录（计划编辑器的模型选择器用）。
   *
   * ⚠ 索菲亚移植点：上游是 `modelDirectories: ModelDirectoryResolver`
   * （宿主服务：`directoryFor(sessionId)`，逐会话解析）。索菲亚没有这个服务，
   * 而 `bridge.ts` 已经有一个**空的目录桩**（`createEmptyModelDirectory()`，
   * 那里写明「不假装能选」）⇒ 这里收窄成**一个目录**，调用方把桩传进来即可。
   *
   * 可选：缺省时 `TeamSection` 不渲染计划编辑器（上游对
   * `modelDirectory === undefined` 就是走这条分支），即**如实少一个入口**，
   * 而不是拿一个假目录把按钮画出来。
   */
  readonly modelDirectory?: ModelDirectory | undefined
  /**
   * 打开某个成员的留痕（上游：`openMember(parentId, childId)` → 宿主 sessions 服务
   * 的 subagent 导航）。
   *
   * ⚠ 索菲亚移植点：上游用宿主的 `SessionId` 品牌类型，索菲亚没有会话/子代理服务，
   * 成员 id 是 `naming.ts` 的不透明标识 ⇒ 两个参数都是 `string`。
   * **本组件不关心调用方拿它做什么**（跳转由接线方实现）；若接线方没有导航能力，
   * 传一个空实现即可 —— 那一点在调用点上是**看得见**的（不像静默默认）。
   */
  readonly openMember: (scope: string, memberId: string) => void
  /**
   * 面板的数据源（`PanelStore` 的结构面）。
   *
   * ⚠ 索菲亚新增 prop：上游没有它 —— 上游的控制器自己去 fetch 它宿主的
   * `/plugins/dsh-agent-teams/state` 路由（`activity-monitor.ts` 的文件头有对照表）。
   * 索菲亚的数据在 store 里，而 store 实例归接线方所有（`index.ts` 建、`panel.tsx` 用）
   * ⇒ 从这里注入，而不是在 `vendor/` 里再造一个单例（那会让「谁在轮询」
   * 出现第二个真相）。必填，理由同上。
   */
  readonly source: ActivitySource
  /**
   * 翻译函数。
   *
   * ⚠ 索菲亚移植点：上游是 `PropsLocale<'agentTeams'>`（宿主 locale 服务注入 `t`）。
   * 索菲亚的等价物是 `bridge.ts` 的 `t`，它的类型就是上游那份字典的签名
   * （`AgentTeamsTranslate`，`../locales.ts`）；与 `../StagingPlanEditor.tsx` 同一种接法
   * ⇒ 调用方不必为了这个面板去造假 locale 服务。
   */
  readonly t: AgentTeamsTranslate
  /**
   * **内联承载**（索菲亚新增，上游没有）：把这个面板当作**页面内容**渲染，
   * 而不是右上角的浮窗。
   *
   * 主人原话：「我说的是把这个这个UI**放进收件箱**」「然后你在这个这个任务的
   * 活动面板**塞进收件箱**」—— 即：收件箱的主区显示的就是**这一套 UI**。
   * 上游的面板天生是「对话旁的浮窗」（`.panel` 是 `position: absolute` +
   * `transform: translate3d(...)`，靠拖拽/吸附定位），直接塞进文档流会浮在
   * 收件箱上面盖住内容 ⇒ hosted 模式做三件事：
   *   ① **恒展开**（收件箱里没有「胶囊」这个形态，不需要点开）；
   *   ② 去掉浮动几何（`position/top/left/transform`，见 CSS 的
   *      `[data-sophia-hosted]`）与拖拽手势（内联面板拖动没有意义）；
   *   ③ 去掉「折叠」按钮（点了会折叠一个恒展开的面板 = 一个按了没反应的按钮）。
   * 其余（标题栏 / 团段 / 团长行 / 总进度 / 成员行 / 拟建团的计划审查）
   * **一个字都不改** —— 外观照抄是本条的硬要求。
   */
  readonly hosted?: boolean | undefined
  /**
   * 建团模式单选的唯一状态源（索菲亚新增，上游没有）。
   * 语义与 `TeamSection.planMode` 完全一致（本组件只往下透传）。
   */
  readonly planMode?: PlanModeControl | undefined
  /**
   * 「确认」真的发生时，把**当前选中的建团模式**一并交出去。
   *
   * ⚠ 为什么需要它：主人要求「选中的值要传进确认动作（不是只画个圈）」。
   *   面板内部的 `确认并启动团队` 属于 `StagingPlanEditor`（**已移植的上游文件，
   *   不在本次施工边界内**），它按完会回调本组件的 `onContinuePlanning`
   *   ⇒ 就在那个回调里把模式交出去，是边界内**唯一**能挂上「确认」这件事的位置。
   *   它之后要真正影响建团结果，还需要两处宿主侧改动（不在本次边界内，报告里已列）。
   */
  readonly onApproveWithMode?: ((requestId: string, mode: PlanMode) => void) | undefined
  /**
   * 索菲亚移植点（可选，上游没有）：拟建团**写动作**（确认 / 放弃）的覆盖点，
   * 原样透传给 `TeamSection` → `StagingPlanEditor`。语义见 TeamSection 的同名注释。
   * ⚠ `requestId` 即拟建态的 `team.teamId`（`adapters/activity.ts:225`）——
   *   调用方拿到 `action` 时**不需要**再传 id：编辑器闭包里已经有正确的那个。
   *   实现侧（panel.tsx）用 React 的 `useCallback` 工厂在渲染处绑定 teamId。
   */
  readonly onPlanAction?: ((action: 'approve' | 'discard', requestId: string) => Promise<void>) | undefined
}

/**
 * 建团模式：`persistent` = 持久团（本版可用），`dag` = DAG 调度模式（阶段 3 才开放）。
 *
 * 取值与索菲亚面板既有单选的 `data-sophia-mode`（`persistent-team` / `dag-scheduler`）
 * 一一对应 —— 面板这边用短名，属性那边用既有口径，映射只写一次（`panel.tsx`）。
 */
export type PlanMode = 'persistent' | 'dag'

/**
 * 建团模式的**状态源接口**（只读 + 写，不存）。
 * 实现归调用方（`panel.tsx`）：一处状态、两处显示。
 */
export interface PlanModeControl {
  /**
   * 三个**已翻译**的文案（「建团模式」/「持久团（当前可用）」/「DAG 调度模式（阶段 3 开放）」）。
   *
   * ⚠ 为什么由调用方传字符串、而不是在这里 `t('modeLabel')`：本组件的 `t` 是
   *   **上游那份字典**的类型（`AgentTeamsTranslate`，180 个键），索菲亚的
   *   `modeLabel`/`modePersistent`/`modeDag` 不在里面（TS2345 实测）。
   *   而主人的要求是「两份 UI 的文案要对得上」⇒ 最稳的接法是**同一个键、同一个
   *   字典**：`panel.tsx` 用索菲亚的 `t` 翻好再传进来（`locales.ts:159-161`），
   *   而不是在这里各写一份中文字面量（那正是「一边一个说法」的来源）。
   */
  readonly label: string
  readonly persistentLabel: string
  readonly dagLabel: string
  /** 读某个建团申请当前选中的模式（`teamId` 在拟建态下**就是** `requestId`，见 `adapters/activity.ts:225`）。 */
  readonly value: (requestId: string) => PlanMode
  /** 改它。 */
  readonly onChange: (requestId: string, mode: PlanMode) => void
}

export function ActivityPanel({ scope, modelDirectory, openMember, source, t, conversationVisible = true, hosted = false, planMode, onApproveWithMode, onPlanAction }: ActivityPanelProps) {
  // Navigating to a member's transcript is an explicit departure:
  // hide the floater immediately instead of waiting out the autocollapse
  // grace, so the panel never lingers over the member view.
  const navigateToSession = (parentId: string, childId: string): void => {
    setOpen(false)
    setWasActive(false)
    openMember(parentId, childId)
  }
  // ── 索菲亚有意偏离上游 #1：默认展开（**已回退，见下面的回退记录**）────────
  // ⚠ **回退记录（实测后推翻自己）**：曾经把这里改成 `useState(true)`、并把 `openOwner`
  //   初值给成 `scope`，理由是「索菲亚主页上折叠等于看不见」。改完用户给了截图：
  //   `UpstreamTeamCard` 是**每个团一张卡**，于是**三个团叠出三个浮窗**，互相遮挡 ——
  //   比折叠更糟。而用户要的其实是「**折叠在右上角、点开看**」。
  //   ⇒ 结论：折叠是对的，错的是**收件箱放的位置**（那才是本次要改的东西）；
  //   控件树实测的 `[Button] "AgentTeams 活动与历史，4 条团队记录" @2240,107` 本来就是
  //   用户想要的形态。留这段是为了让后人看到「为什么这里不该改成 true」。
  // 上游这里是 `useState(false)` —— 对上游是对的：它是**对话旁的浮窗**，默认折叠才
  // 不挡对话；而且它靠 `activityPanelShouldAutoExpand` 在有**新**团出现时自动展开。
  //
  // 但对索菲亚是错的，两条理由都是实测出来的：
  //   · 这个面板不是「对话旁的浮窗」，它就是**索菲亚的主页**（侧栏「索菲亚」点进来的
  //     那一屏）。默认折叠 ⇒ 用户什么都看不到，只剩右上角一个小胶囊；
  //   · 那条自动展开**在索菲亚永远不会触发**：它要求 `AUTO_OPEN_SETTLE_MS`(4000ms) 的
  //     页面稳定窗口之后出现「`previousLiveTeamIds` 里没有的团」，而刷新之后这个团
  //     本来就在集合里 ⇒ 永远不满足。
  // 实测证据（改之前）：控件树里只有 `[Button] "AgentTeams 活动与历史，4 条团队记录"
  // @2240,107 47x34` 这一个 47×34 的胶囊，浮窗主体一个控件都没有。
  const [open, setOpen] = useState(true)
  // ── 索菲亚有意偏离上游 #2：`openOwner` 初值给 `scope` ─────────────────
  // 展开判据是 `activityPanelExpandedForSession(open, openOwner, current)`
  // = `open && openOwner !== undefined && openOwner === current`
  // （`activity-model.ts`）—— 所以**光把 `open` 改成 true 没用**：`openOwner` 是
  // `undefined` 时它仍然返回 false。上游靠用户点胶囊来 `setOpenOwner(current)`。
  //
  // 为什么初值能用 `scope`：`scope` 是 prop，这一行就可用；而 `current` 要到下面
  // （`const current: string | undefined = scope`）才赋值，用不到。两者同源，
  // 所以直接用 `scope` 是等价的，不是抄近路。
  const [openOwner, setOpenOwner] = useState<string | undefined>()
  const [autoOpened, setAutoOpened] = useState(false)
  const [wasActive, setWasActive] = useState(false)
  const [layout, setLayout] = useState<PanelLayout>(initialPanelLayout)
  const [bounds, setBounds] = useState<PanelBounds>(initialPanelBounds)
  const [interaction, setInteraction] = useState<'dragging' | 'resizing' | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const boundsRef = useRef(bounds)
  const gestureRef = useRef<PanelGesture | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingLayoutRef = useRef<PanelLayout | null>(null)
  // ⚠ 索菲亚移植点：上游这里从宿主的会话列表服务取「当前 captain 会话」
  //   （`useSyncExternalStore(sessionsList.subscribe, sessionsList.getSnapshot).current`）。
  // 索菲亚的作用域由 prop 直接给定（见 `ActivityPanelProps.scope`）⇒ 一行赋值。
  // `undefined` 仍有意义（上游语义：没有当前会话 ⇒ 不显示任何团），保持类型 `string | undefined`。
  const current: string | undefined = scope
  // ⚠ 内部字段名沿用上游的 `sessionId`：它的值在索菲亚就是 `current`（作用域）。
  // 保持名字不变，是为了跟上游版本时这一整块能原样对上；语义差异统一写在文件头。
  const autoOpenTrackerRef = useRef<{
    sessionId: string | undefined
    restoreComplete: boolean
    liveTeamIds: ReadonlySet<string>
  }>({ sessionId: current, restoreComplete: false, liveTeamIds: new Set() })
  const monitorTargets = useSyncExternalStore(
    subscribeActivityMonitorTargets,
    getActivityMonitorTargetsSnapshot,
    // ⚠ 索菲亚移植点（SSR）：第 3 个参数是服务端快照 —— 本仓用例走 SSG
    //（`renderToStaticMarkup`），缺它 React 直接抛 `Missing getServerSnapshot`。
    // 取「与 getSnapshot 同一个读函数」：服务端首帧读到的就是当前快照。
    // 详见文件头「索菲亚移植点」第 6 条。
    getActivityMonitorTargetsSnapshot,
  )
  const returnToComposer = (): void => {
    setOpen(false)
    setOpenOwner(undefined)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(
        '[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea',
      )?.focus()
    })
  }
  const { teams, archivedTeams } = useSyncExternalStore(
    subscribeActivitySnapshots,
    getActivitySnapshotsSnapshot,
    // ⚠ 索菲亚移植点（SSR）：同上一处，服务端快照（文件头第 6 条）。
    getActivitySnapshotsSnapshot,
  )
  const currentTargets = useMemo(
    () => current === undefined ? [] : monitorTargets.filter((target) => target.sessionId === current),
    [current, monitorTargets],
  )
  const mountedAtRef = useRef(performance.now())
  // ⚠ `hosted`（索菲亚新增）短路在**最前面**：收件箱里的这一份是**页面内容**，
  //   必须恒展开 —— 它没有「右上角胶囊」那个形态（`!expanded` 时渲染的是
  //   `CollapsedBadge`，塞进收件箱会变成一颗孤零零的按钮）。
  //   上游那条自动展开判据（`activityPanelExpandedForSession`）要求
  //   `openOwner === current`，而 `openOwner` 只在用户点胶囊时被写 ⇒ 不短路的话
  //   收件箱里会**永远**是空的。宿主是上游没有的形态，所以这里是有意偏离。
  const expanded = hosted || (conversationVisible && activityPanelExpandedForSession(open, openOwner, current))
  const geometry = useMemo(() => resolvePanelGeometry(layout, bounds), [layout, bounds])
  const compact = compactPanelForBounds(bounds)

  const commitLayout = useCallback((next: PanelLayout): void => {
    setLayout(next)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  }, [layout])

  // The slot sits inside AppFrame, so all geometry is measured against the
  // shell overlay rather than the browser viewport. The conversation's real
  // right edge is the dock anchor and naturally follows sidebar/details
  // concessions without importing their hashed implementation classes.
  useLayoutEffect(() => {
    const overlay = document.querySelector<HTMLElement>('[data-shell-overlay]')
    if (overlay === null) return
    const conversation = document.querySelector<HTMLElement>("[data-phase='active']")
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      const overlayRect = overlay.getBoundingClientRect()
      const conversationRect = conversation?.getBoundingClientRect()
      const next: PanelBounds = {
        width: overlayRect.width,
        height: overlayRect.height,
        anchorRight: conversationRect === undefined
          ? overlayRect.width
          : Math.min(Math.max(conversationRect.right - overlayRect.left, 0), overlayRect.width),
      }
      const previous = boundsRef.current
      if (previous.width === next.width
        && previous.height === next.height
        && previous.anchorRight === next.anchorRight) return
      boundsRef.current = next
      setBounds(next)
    }
    const scheduleMeasure = (): void => {
      frame ??= requestAnimationFrame(measure)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    observer?.observe(overlay)
    if (conversation !== null) observer?.observe(conversation)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [current])

  // This shell overlay survives conversation route changes. Gate expansion by its
  // owning session during render, then clear stale state before paint. This
  // removes the old panel immediately instead of waiting for the no-team
  // autoclose grace period on the destination page.
  useLayoutEffect(() => {
    const tracker = autoOpenTrackerRef.current
    if (tracker.sessionId !== current) {
      tracker.sessionId = current
      tracker.restoreComplete = false
      tracker.liveTeamIds = new Set()
      setWasActive(false)
      setAutoOpened(false)
    }
    if (openOwner === undefined || openOwner === current) return
    setOpen(false)
    setOpenOwner(undefined)
  }, [current, openOwner])

  // Only the wide docked mode asks the conversation column to yield. Floating
  // and compact modes are intentionally true overlays. The width is written as
  // one shared variable so the panel and the concession cannot drift apart.
  useLayoutEffect(() => {
    const root = document.documentElement
    const shouldYield = expanded && geometry.mode === 'docked' && !compact
    if (shouldYield) {
      root.setAttribute(PANEL_OPEN_ATTRIBUTE, '')
      root.style.setProperty(PANEL_SHIFT_PROPERTY, `${geometry.width + PANEL_CONVERSATION_GAP + 18}px`)
    } else {
      root.removeAttribute(PANEL_OPEN_ATTRIBUTE)
      root.style.removeProperty(PANEL_SHIFT_PROPERTY)
    }
    return () => {
      root.removeAttribute(PANEL_OPEN_ATTRIBUTE)
      root.style.removeProperty(PANEL_SHIFT_PROPERTY)
    }
  }, [compact, expanded, geometry.mode, geometry.width])

  useEffect(() => {
    if (current === undefined) return
    // ⚠ 索菲亚移植点（数据入口）：
    // 上游这一行是 `startActivityPolling(currentTargets, { discoverySessionId: current })`
    // —— 控制器自己去 fetch 它宿主的 `/plugins/dsh-agent-teams/state`。
    // 索菲亚把数据源从**注入点**（`source`，见 `ActivityPanelProps.source`）取，
    // 作用域字段名从 `discoverySessionId` 改成 `scope`（索菲亚的团不绑会话）。
    // 其余（首帧可等待、退出时 stop）没变。
    const controller = startActivityPolling(currentTargets, { scope: current, source })
    let active = true
    // ⚠ 索菲亚移植点：上游这段注释说的是「冷启动时补一趟发现，让归档的/没有卡片
    // 的团在浏览器或 `dsh web` 重启后仍能被看到」。索菲亚**没有归档半边**
    // （见 `activity-monitor.ts` 的 tick 注释），但这一趟「首帧补读」的**另一个作用**
    // 在索菲亚完全成立且必需：它把 `restoreComplete` 立在**第一次真实读取之后**，
    // 于是「页面加载时就已经存在的团」只显示折叠徽标、不会把会话列挤开
    // （`AUTO_OPEN_SETTLE_MS` 那套自动展开策略依赖这个标记）。
    const tracker = autoOpenTrackerRef.current
    if (tracker.sessionId === current && !tracker.restoreComplete) {
      void controller.firstTick.then(() => {
        const latest = autoOpenTrackerRef.current
        if (!active || latest.sessionId !== current || latest.restoreComplete) return
        latest.liveTeamIds = new Set(getActivitySnapshotsSnapshot().teams
          .filter((team) => team.captainSessionId === current)
          .map((team) => team.teamId))
        latest.restoreComplete = true
      })
    }
    return () => {
      active = false
      controller.stop()
    }
  }, [current, currentTargets, source])

  // ── 索菲亚剥除（改动之三）：上游的 `agent-teams:open-panel` 窗口事件监听 ─────────
  //
  // 上游这里有一个 `useEffect`，监听 `window` 上的 `OPEN_PANEL_EVENT`
  // （字面量 `'agent-teams:open-panel'`，定义在 `AgentTeamsCard.tsx`）：对话里那张
  // 内嵌卡片被点击时派发它，面板收到后**展开自己**，并把卡片带过来的那份
  // `AgentTeamsCardData`（teamId / captainSessionId / teamName / members）塞进
  // `historic` 状态 —— 用途是「宿主归档已经消失的旧团，靠卡片自带的名册在面板里
  // 重建出只读摘要」（配套的投影函数是上游的 `historicCardTeam()`，本文件也一并删了）。
  //
  // **为什么剥掉**（三条，每条都是索菲亚侧的结构性事实，不是"暂时不做"）：
  // ① 索菲亚**没有**对话内嵌卡片：那张卡片的挂载点是宿主的
  //    `conversation.chat.node` 座位（`agent-teams-card-definition.ts` 里
  //    `ConversationNodeDefinition` + `ChatNodeDataMap` 的模块增强），索菲亚的
  //    client 半只声明了 `inject: ['slots']`，没有会话/对话节点座位 ⇒ 没有生产者；
  // ② 索菲亚**没有** `agent-teams:open-panel` 这个窗口事件：它是上游宿主与它自己
  //    客户端两半之间的私有协议，索菲亚的宿主半里不存在（不是"改了名"，是根本没有）；
  // ③ 它服务的那个场景在索菲亚**不存在**：索菲亚的 `archivedTeams` 恒为空
  //    （见 `activity-monitor.ts`），没有"宿主归档没了、只能靠卡片重建"的团 ——
  //    账本读取本身就把团给全了。
  //
  // 剥掉的**具体内容**（便于将来核对）：`historic` state、`currentRef`、
  // 上面那个 `useEffect`、`historicCardTeam()`、`visibleHistoric` 及其渲染块，
  // 外加 `OPEN_PANEL_EVENT` / `AgentTeamsCardData` 两条 import。
  //
  // 若将来索菲亚真的要恢复这个入口，需要先有：① 一个对话内嵌座位的实现
  // （宿主 `conversation.chat.node` 的可用性）；② 一个「宿主归档已消失但界面仍要
  // 显示只读摘要」的真实场景（现在没有）。在那之前把它留在这里只会是一条
  // **永远不触发**的监听器 —— 那种"看起来接好了、其实没人派发"的代码，
  // 比明确地没有它更难排查。

  // Live snapshots are visible only while their scope is the current one.
  const visibleTeams = useMemo(
    // No current scope (nothing picked yet): show nothing, so another scope's
    // teams never leak into the floater. （索菲亚接线时 `current` 是 `''` 而不是
    // `undefined`，所以这一支在索菲亚**不会被**误触发 —— 见 props 说明。）
    () => (current === undefined ? [] : teams.filter((team) => team.captainSessionId === current)),
    [teams, current],
  )
  // ⚠ 索菲亚剥除：上游这里还有一份 `visibleHistoric`（来自卡片事件的 `historic` 状态，
  // 与 live/archived 去重后投影成只读摘要）。见上方「索菲亚剥除」段落。
  const visibleArchived = useMemo(
    () => (current === undefined ? [] : archivedTeams.filter((team) =>
      team.captainSessionId === current && !teams.some((live) =>
        live.captainSessionId === current && live.teamId === team.teamId,
      ),
    )),
    [archivedTeams, current, teams],
  )
  const visibleCount = visibleTeams.length + visibleArchived.length
  const visibleLiveTeamIds = useMemo(
    () => visibleTeams.map((team) => team.teamId).sort(),
    [visibleTeams],
  )
  const visibleLiveTeamKey = visibleLiveTeamIds.join('\u0000')

  useEffect(() => {
    const tracker = autoOpenTrackerRef.current
    const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS
    const shouldAutoExpand = tracker.sessionId === current && activityPanelShouldAutoExpand({
      alreadyAutoOpened: autoOpened,
      pageSettled: settled,
      restoreComplete: tracker.restoreComplete,
      previousLiveTeamIds: tracker.liveTeamIds,
      currentLiveTeamIds: visibleLiveTeamIds,
    })
    if (tracker.sessionId === current && tracker.restoreComplete) {
      tracker.liveTeamIds = new Set(visibleLiveTeamIds)
    }
    if (visibleCount > 0) {
      setWasActive(true)
      // Existing state restored for a reopened conversation stays collapsed.
      // Only a live team that appears after the restore pass may auto-expand.
      if (shouldAutoExpand) {
        setOpenOwner(current)
        setOpen(true)
        setAutoOpened(true)
      }
      return
    }
    if (!wasActive) return
    const timer = setTimeout(() => {
      setOpen(false)
      setOpenOwner(undefined)
      setWasActive(false)
      // Re-arm auto-expand: a later activity (new team, new session) may
      // open the panel on its own again.
      setAutoOpened(false)
    }, AUTOCLOSE_GRACE_MS)
    return () => { clearTimeout(timer) }
  }, [visibleCount, visibleLiveTeamKey, autoOpened, wasActive, current])

  const busy = useMemo(
    () => visibleTeams.some((team) => team.members.some((member) => member.activity === 'working')),
    [visibleTeams],
  )
  const hasTeams = visibleCount > 0

  // Auto-height panels do not store their live content height. Capture the
  // rendered box when a pointer gesture starts so movement and a first manual
  // resize clamp against what the user actually sees.
  const panelGeometryForGesture = useCallback((): PanelLayout => {
    const measuredHeight = panelRef.current?.getBoundingClientRect().height
    if (measuredHeight === undefined || measuredHeight <= 0) return geometry
    return { ...geometry, height: measuredHeight }
  }, [geometry])

  const flushScheduledLayout = useCallback((): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const pending = pendingLayoutRef.current
    pendingLayoutRef.current = null
    if (pending !== null) commitLayout(pending)
  }, [commitLayout])

  const scheduleLayout = useCallback((next: PanelLayout): void => {
    pendingLayoutRef.current = next
    frameRef.current ??= requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingLayoutRef.current
      pendingLayoutRef.current = null
      if (pending !== null) commitLayout(pending)
    })
  }, [commitLayout])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  const beginMove = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (compact || event.button !== 0 || (event.target as Element).closest('button') !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: panelGeometryForGesture(),
      activated: false,
    }
  }, [compact, panelGeometryForGesture])

  const beginResize = useCallback((edge: PanelResizeEdge, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (compact || event.button !== 0 || (geometry.mode === 'docked' && edge !== 'left')) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      kind: 'resize',
      edge,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: panelGeometryForGesture(),
      activated: true,
    }
    setInteraction('resizing')
  }, [compact, geometry.mode, panelGeometryForGesture])

  const updateGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId
      || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.clientX - gesture.originX
    const dy = event.clientY - gesture.originY
    const activeBounds = boundsRef.current
    if (gesture.kind === 'move') {
      if (!gesture.activated && Math.hypot(dx, dy) < MOVE_THRESHOLD) return
      if (!gesture.activated) {
        gesture.activated = true
        setInteraction('dragging')
      }
      scheduleLayout(movePanelLayout(
        floatPanelLayout(gesture.start, activeBounds),
        dx,
        dy,
        activeBounds,
      ))
      return
    }
    scheduleLayout(resizePanelLayout(
      gesture.start,
      gesture.edge ?? 'left',
      dx,
      dy,
      activeBounds,
    ))
  }, [scheduleLayout])

  const endGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    updateGesture(event)
    flushScheduledLayout()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    gestureRef.current = null
    setInteraction(null)
  }, [flushScheduledLayout, updateGesture])

  const cancelGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    flushScheduledLayout()
    gestureRef.current = null
    setInteraction(null)
  }, [flushScheduledLayout])

  const toggleDock = useCallback((): void => {
    const liveGeometry = panelGeometryForGesture()
    commitLayout(liveGeometry.mode === 'docked'
      ? floatPanelLayout(liveGeometry, boundsRef.current)
      : dockPanelLayout(liveGeometry, boundsRef.current))
  }, [commitLayout, panelGeometryForGesture])

  const autoHeight = panelUsesAutoHeight(geometry, bounds)

  const panelStyle: CSSProperties = {
    width: geometry.width,
    height: autoHeight ? 'auto' : geometry.height,
    maxHeight: panelMaximumHeight(geometry, bounds),
    transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`,
  }

  if (!conversationVisible || (!hasTeams && !expanded)) return null

  return (
    <>
      {!expanded && (
        <CollapsedBadge count={visibleCount} busy={busy} t={t} onClick={() => {
          if (current === undefined) return
          setOpenOwner(current)
          setOpen(true)
        }} />
      )}
      {expanded && (
        <aside
          ref={panelRef}
          className={css.panel}
          // ⚠ hosted：不给浮动几何（`width/height/maxHeight/translate3d`）——
          //   尺寸交给 CSS 的 `[data-sophia-hosted]`（`position: static` + 流式高度），
          //   否则面板会带着「被拖到某处」的坐标浮在收件箱上面。
          style={hosted ? undefined : panelStyle}
          data-agent-teams-activity
          data-sophia-hosted={hosted || undefined}
          data-panel-mode={geometry.mode}
          data-height-mode={autoHeight ? 'auto' : 'manual'}
          data-compact={compact || undefined}
          data-dragging={interaction === 'dragging' || undefined}
          data-resizing={interaction === 'resizing' || undefined}
          aria-label={t('activity.panelAria')}
        >
          <header
            className={css.panelHead}
            // ⚠ hosted：不挂拖拽手势（内联面板「拖动」没有意义，却会留下
            //   一个被拖走的 document 流坐标 —— 拖完看起来就是内容消失）。
            {...(hosted
              ? {}
              : {
                  onPointerDown: beginMove,
                  onPointerMove: updateGesture,
                  onPointerUp: endGesture,
                  onPointerCancel: cancelGesture,
                })}
            data-drag-handle={!hosted && !compact ? true : undefined}
          >
            <span className={css.panelTitle}>
              {t('activity.title')}
              <span className={css.panelDot} data-busy={busy} aria-hidden />
            </span>
            <span className={css.panelControls}>
              {/* ⚠ hosted：吸附/浮动与折叠这两个控件在内联形态下都是**假的** ——
                  dock 切换的是「浮窗贴哪边」，collapse 折叠的是「浮窗要不要收起」，
                  而收件箱里这一份既不是浮窗、也恒展开。留着一个按了没反应的按钮，
                  比不渲染它更坏（主人给过的验收口径也是「点了要有反应」）。
                  标题栏的其余部分（标题 / 忙碌小点）照抄不动。 */}
              {!compact && !hosted && (
                <button
                  type="button"
                  className={css.iconButton}
                  data-control="dock"
                  data-mode={geometry.mode}
                  onClick={toggleDock}
                  aria-label={t(geometry.mode === 'docked' ? 'activity.float' : 'activity.dockRight')}
                  title={t(geometry.mode === 'docked' ? 'activity.float' : 'activity.dockRight')}
                >
                  <primitives.IconPanelLeftOutline16 />
                </button>
              )}
              {!hosted && (
                <button
                  type="button"
                  className={css.iconButton}
                  data-control="collapse"
                  onClick={() => {
                    setOpen(false)
                    setOpenOwner(undefined)
                  }}
                  aria-label={t('activity.collapse')}
                  title={t('activity.collapse')}
                >
                  <primitives.IconChevronDownOutline14 />
                </button>
              )}
            </span>
          </header>
          <div className={css.teams}>
            {visibleCount === 0
              ? <span className={css.emptyHint}>{t('activity.empty')}</span>
              : (
                <>
                  {visibleTeams.map((team) => (
                    <TeamSection
                      key={team.teamId}
                      team={team}
                      // ⚠ 索菲亚移植点：上游是 `modelDirectories.directoryFor(team.captainSessionId)`
                      // （逐会话解析）。索菲亚只有一个目录（`bridge.ts` 的空目录桩，缺省时
                      // 计划编辑器整块不渲染 —— 上游对 `modelDirectory === undefined`
                      // 走的正是这条分支）。
                      modelDirectory={team.phase === 'staged' ? modelDirectory : undefined}
                      // ⚠ hosted 的「确认」挂点：面板内部的 `确认并启动团队` 属于
                      //   `StagingPlanEditor`（不在本次施工边界内），它按完会回调
                      //   本组件的 `onContinuePlanning` ⇒ 就在这一次回调里把**当前选中的
                      //   建团模式**交给调用方（`onApproveWithMode`），主人的
                      //   「选中值要传进确认动作，不是只画个圈」在边界内只有这样能落地。
                      //   拟建态下 `team.teamId` **就是** `requestId`（`adapters/activity.ts:225`）。
                      onContinuePlanning={onApproveWithMode === undefined || planMode === undefined
                        ? returnToComposer
                        : () => {
                            onApproveWithMode(team.teamId, planMode.value(team.teamId))
                            returnToComposer()
                          }}
                      onDiscarded={returnToComposer}
                      {...(onPlanAction === undefined ? {} : {
                        // 编辑器现在**自己**补 requestId（`team.teamId`，拟建态 = requestId）
                        // ⇒ 这里直接转发，不再二次绑定（双重绑定会把编辑器给的 id 盖掉）。
                        onPlanAction,
                      })}
                      onNavigate={navigateToSession}
                      {...(planMode === undefined ? {} : { planMode })}
                      t={t}
                    />
                  ))}
                  {visibleArchived.map((team) => (
                    <div key={`${team.captainSessionId}:${team.teamId}`} data-team-id={team.teamId} data-historic className={css.archivedWrap}>
                      <span className={css.archiveLabel}>{t(team.phase === 'staged' ? 'archive.discardedLabel' : 'archive.label')}</span>
                      <TeamSection team={team} onNavigate={navigateToSession} t={t} historic />
                    </div>
                  ))}
                  {/* ⚠ 索菲亚剥除：上游这里还有一块 `visibleHistoric.map(...)`，
                      把卡片事件带来的历史团投影成 `historicCardTeam(...)` 再渲染。
                      `archivedTeams` 与 `historic` 两个来源在索菲亚都不存在
                      （账本读取给全了 / 没有卡片事件），见上方「索菲亚剥除」段落。
                      注意：`visibleArchived` 这一块**没有**剥掉 —— 它是上游的归档渲染面，
                      索菲亚的数据源（`activity-monitor.ts` 的 `archivedTeams`）一旦有值
                      （宿主将来把归档团单独投影出来）它立刻可用，UI 不用改。 */}
                </>
              )}
          </div>
          {!compact && (
            <div
              className={css.resizeHandle}
              data-resize-edge="left"
              onPointerDown={(event) => { beginResize('left', event) }}
              onPointerMove={updateGesture}
              onPointerUp={endGesture}
              onPointerCancel={cancelGesture}
              aria-hidden
            />
          )}
          {!compact && geometry.mode === 'floating' && (
            <>
              <div
                className={css.resizeHandle}
                data-resize-edge="bottom"
                onPointerDown={(event) => { beginResize('bottom', event) }}
                onPointerMove={updateGesture}
                onPointerUp={endGesture}
                onPointerCancel={cancelGesture}
                aria-hidden
              />
              <div
                className={css.resizeHandle}
                data-resize-edge="corner"
                onPointerDown={(event) => { beginResize('corner', event) }}
                onPointerMove={updateGesture}
                onPointerUp={endGesture}
                onPointerCancel={cancelGesture}
                aria-hidden
              />
            </>
          )}
        </aside>
      )}
    </>
  )
}
