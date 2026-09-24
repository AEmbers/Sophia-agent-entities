/**
 * 界面组件（频道页 / 成员卡 / 活动面板）。
 *
 * ## 三条与素材相关的硬约束（实测得出，改动前先读）
 *
 * 1. **姓名必须由 DOM 文本渲染**。头像底部烧入的职位名在 24px 下
 *    **完全不可读** —— 小尺寸场景唯一可读的来源就是 `MemberCard` 里的
 *    `.sp-member-name`。删掉那行文本，界面上就再也认不出谁是谁。
 * 2. **不做头像二次裁切**。素材的底部标签余量仅 15px，任何 `object-position` /
 *    内边距微调都会切到字。头像只允许 `border-radius: 50%` + `object-fit: cover`
 *    （见 `styles.ts`）。
 * 3. **显示名与图上标签一致**。职位标签已烧入像素（不透明占比 94.4%），
 *    界面**无法改写**头像上的字 ⇒ 显示名用宿主给的 `displayName`
 *    （其裁决在 `naming.ts` 的 `displayNameOf`），客户端**不另发明**一个。
 *
 * ## 每个组件都必须是**纯函数组件**（无类、无副作用）
 *
 * 这样它们可以在 node 里用 `react-dom/server` 直接渲染成 HTML 字符串做断言
 * （`tests/client/*.spec.tsx` 就是这么做端到端验证的），不需要 jsdom。
 *
 * ## 错误隔离
 *
 * 每个叶子组件自己 `try/catch`（`Guard`）是**不必要**的：slot 渲染器本身有
 * `SlotErrorBoundary`（实测 `dsh-client-ui-renderer/lib/client.js:519`）。
 * 重复加一层只会让栈更难读。故这里只保证「坏数据不抛」—— 收窄在
 * `view-model.ts` 里已经做完，组件拿到的类型是**已经验证过**的。
 *
 * @module @sophia/core/client/components
 */

import type { ReactElement } from 'react'

import { hooks } from './react-runtime.ts'
import { CLASS } from './styles.ts'
import { resolveAvatarUrl } from './avatar.ts'
// ── 上游 CSS Modules（构建期内联的**类名映射**）────────────────────────────
//
// 为什么直接引它，而不是继续在 `styles.ts` 里手写：本面板的**皮肤**以上游
// `dsh-agent-teams` 的活动面板为准（主人实测指出成员行/徽章/进度/任务行
// 看着是"另一套朴素样式"）。上游那份 `ActivityPanel.module.css` 已经调好了
// 间距/字号/层次语言，重写一份只会**再次漂移**。
//
// 取用方式与 `vendor/StagingPlanEditor.tsx` 一致：构建期的
// `sophia-css-modules-inline`（`tsdown.config.ts`）把 `.module.css` 编译成
// 「CSS 文本 + `{local: '<hash>_<local>'}`」的 JS 模块，运行期 `css.memberRow`
// 就是那个哈希类名；CSS 文本在同一刻注入 `<style>`（`data-plugin-css` 判重）。
// ⚠ 它**不产生 require**（样式是内联的模块，不是外部资源）——
//   `lib/client.js` 里 `require(` 的次数仍必须是 2（`tests/client-sources.spec.ts:254`）。
import css from './vendor/ActivityPanel.module.css'
import type { LocaleKey } from './locales.ts'
import {
  blockersOf,
  displayNameIn,
  formatClock,
  initialOf,
  lifecycleKeyOf,
  memberIndex,
  messagesOfTeam,
  onlineCount,
  presenceKeyOf,
  sortMembers,
  summarizeProgress,
  taskStatusKeyOf,
  type WireChannel,
  type WireMember,
  type WireTask,
  type WireTeam,
  type WireThread,
} from './view-model.ts'

/** 文案函数签名。 */
export type Translate = (key: LocaleKey, params?: Readonly<Record<string, string | number>>) => string

/** 组件的公共 props。 */
export interface PanelProps {
  readonly t: Translate
  readonly team: WireTeam
}

// ────────────────────────────────────────────────────────────────────────────
// 小工具
// ────────────────────────────────────────────────────────────────────────────

/** 状态点要显示的**唯一**状态种类（颜色与文案都由它派生）。 */
type DotVisual = 'tombstone' | 'running' | 'idle' | 'suspended' | 'unknown'

/**
 * 判出**这一个**成员该显示哪种状态点。
 *
 * 抽成函数而不是内联五层三元：本仓的检查单明确禁止嵌套三元
 * （OCR 复核 LOW 也点了这条），而且拆开之后「颜色」与「文案」有了
 * 同一个来源，结构上不可能再分叉 —— 这正是修那个
 * 「黄点配『状态未知』」缺陷的手法。
 */
function dotVisualOf(member: WireMember): DotVisual {
  // 墓碑优先：`archived`/`destroyed` 的成员即使运行时有残留存在态，
  // 界面也不该显示成「工作中」——那会让人以为他还在干活。
  if (member.tombstone) return 'tombstone'
  const presenceKey = presenceKeyOf(member.presence)
  if (presenceKey === 'presenceRunning') return 'running'
  if (presenceKey === 'presenceIdle') return 'idle'
  if (member.lifecycle === 'suspended') return 'suspended'
  // 既没有存在态、也不是挂起 ⇒ **不猜**（猜就是 FR-10.2 禁的独立真相）。
  return 'unknown'
}

/** 状态种类 → 类名。 */
const DOT_CLASS: Readonly<Record<DotVisual, string>> = {
  tombstone: CLASS.dotTombstone,
  running: CLASS.dotRunning,
  idle: CLASS.dotIdle,
  suspended: CLASS.dotSuspended,
  unknown: CLASS.dotUnknown,
}

/** 状态种类 → 文案键。 */
const DOT_LABEL: Readonly<Record<DotVisual, LocaleKey>> = {
  tombstone: 'tombstoneBadge',
  running: 'presenceRunning',
  idle: 'presenceIdle',
  suspended: 'lifecycleSuspended',
  unknown: 'lifecycleUnknown',
}

/**
 * 状态点（存在态优先，其次生命周期，再次「未知」）。
 *
 * ⚠ **点的颜色与它的 `aria-label` / `title` 必须说同一件事**
 * （OCR 复核 MEDIUM 抓到的真实缺陷）：初版的 `title` 只看存在态，
 * 于是「`suspended` 且没有 `presence`」的成员画出**黄色挂起点**、
 * 提示却写「状态未知」—— 视觉与读屏互相矛盾，而挂起状态是**有**明确文案的。
 *
 * 修法不是「给 title 再补一个分支」（那还是会分叉），而是**先判出唯一的状态
 * 种类、再由它同时派生类名与文案键** —— 两者结构上不可能不一致。
 */
export function StateDot(props: {
  readonly member: WireMember
  readonly t: Translate
}): ReactElement | null {
  const { member, t } = props
  const visual = dotVisualOf(member)
  const title = t(DOT_LABEL[visual])
  return (
    <span
      className={`${CLASS.dot} ${DOT_CLASS[visual]}`}
      data-sophia-dot={member.lifecycle}
      data-sophia-presence={member.presence ?? 'none'}
      data-sophia-visual={visual}
      title={title}
      role="img"
      aria-label={title}
    />
  )
}

/**
 * 成员头像。
 *
 * 头像取不到时**降级成首字方块**，而不是画一个破图 —— 那既保留信息密度，
 * 也让「图没加载出来」不至于看起来像界面坏了。
 *
 * ⚠ 失败标记**按 URL 记忆**（OCR 复核 LOW 抓到的真实缺陷）：
 * 初版是一个永不重置的 `failed: boolean`，于是「某次 404」会把该成员的头像
 * **永久**钉在首字方块上 —— 即使后来宿主头像路由上线、`avatarPath` 变了，
 * 组件由于是按 `memberId` keyed 的、不会重挂，也就永远不会再试一次。
 * 现在记的是「**哪一个 URL** 失败过」：URL 一变就自动重试。
 */
export function MemberAvatar(props: {
  readonly member: WireMember
  /** 覆盖尺寸（活动面板用小一号）；默认 32px。 */
  readonly size?: number
}): ReactElement | null {
  const { member, size } = props
  const { useState } = hooks()
  const url = resolveAvatarUrl(member)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const style = size === undefined ? undefined : { width: `${size}px`, height: `${size}px` }
  if (url === null || failedUrl === url) {
    return (
      <span
        className={CLASS.avatarFallback}
        data-sophia-avatar="fallback"
        style={style}
        aria-hidden="true"
        title={member.displayName}
      >
        {initialOf(member)}
      </span>
    )
  }
  return (
    <img
      className={CLASS.avatar}
      data-sophia-avatar="image"
      src={url}
      alt=""
      // 装饰性图片：姓名由旁边的 DOM 文本给出（素材硬约束 1），
      // 故这里 `alt=""` 避免读屏重复念一遍名字。
      aria-hidden="true"
      style={style}
      onError={() => {
        setFailedUrl(url)
      }}
    />
  )
}

/**
 * 这个成员**能不能换模**（= 界面该不该给它展示换模入口）。
 *
 * ⚠ 抽成**导出的单一判据**（OCR 复核 MEDIUM）：初版这个成员级条件在
 *   `MemberCard` 与 `panel.tsx`（决定 `data-sophia-pluginswitch` 报
 *   present/absent）里**各写了一遍**，而 `panel.tsx` 的注释还声称
 *   「与 `MemberCard` 的判据同源」—— **注释说的和代码做的不一致**（它只是抄了一份）。
 *   两处一旦分叉，属性就会谎报 DOM 里不存在的能力（本文件反复要避免的那类）。
 *   ⇒ 现在只有一个定义，两边都从它取。
 *
 * 注意本判据**只含成员自身的条件**：还要不要看 `onSwitchModel` 有没有回调、
 *   是不是 compact 形态，由调用点各自决定（那是**渲染上下文**，不是成员属性）。
 */
export function canSwitchModel(member: WireMember): boolean {
  // 墓碑成员已归档/销毁 ⇒ 不该还能换。
  // `model === null` = 跟随全局默认 ⇒ **没有可提交的目标**，展示入口等于
  // 展示一个做不到的操作（宿主只会拒掉，或更糟地当成空选择应用）。
  return member.tombstone === false && member.model !== null
}

/**
 * 成员卡：头像 + 显示名 + 状态点 + 模型切换入口。
 *
 * @param props - `compact` 为活动面板里的胶囊形态（无模型入口）。
 */
/**
 * lifecycle 按钮判据（OCR [23] 抽出组件外的**单源**）：
 * active → 挂起；suspended → 恢复；其余（archived/destroyed）→ null（无按钮）。
 */
export function lifecycleActionOf(member: WireMember): 'suspend' | 'resume' | null {
  if (member.lifecycle === 'active') return 'suspend'
  if (member.lifecycle === 'suspended') return 'resume'
  return null
}

export function MemberCard(props: {
  readonly member: WireMember
  readonly t: Translate
  readonly compact?: boolean
  readonly onSwitchModel?: ((member: WireMember) => void) | undefined
  readonly onLifecycle?: ((memberId: string, action: 'suspend' | 'resume') => Promise<void>) | undefined
}): ReactElement | null {
  const { member, t, compact, onSwitchModel, onLifecycle } = props
  const lifecycleKey = lifecycleKeyOf(member.lifecycle)
  const modelText = member.model === null
    ? t('modelFollowDefault')
    : t('modelOf', { provider: member.model.provider, model: member.model.model })
  // ⚠ 只有**有明确换模目标**时才显示入口（OCR 复核 MEDIUM 抓到的真实缺陷）：
  //   `model === null` 表示「跟随全局默认」，此时没有可提交的 provider/model；
  //   显示一个点了发 `{provider:'', model:''}` 的按钮，等于**展示一个做不到的操作**。
  //   这里隐藏入口，`seats.tsx` 的点击处理里再拒一次（两层）。
  //   ⚠ 成员条件走 `canSwitchModel`（与 `panel.tsx` 的 `data-sophia-pluginswitch`
  //     同源；见该函数的说明）。
  const canSwitch = compact !== true
    && onSwitchModel !== undefined
    && canSwitchModel(member)
  const switchButton = canSwitch
    ? (
        <button
          type="button"
          className={CLASS.switchButton}
          data-sophia-action="switch-model"
          data-sophia-member={member.memberId}
          onClick={() => {
            onSwitchModel(member)
          }}
          title={t('switchModelHint')}
        >
          {t('switchModel')}
        </button>
      )
    : null
  // lifecycle 运营按钮（文档 4）：active → 挂起；suspended → 恢复。
  // 销毁（destroyed）**不给 UI 出口** —— 不可逆且危险，留给工具/命令面；
  // 墓碑成员同理不显示（tombstone 是历史事实，UI 不提供复活）。
  // ⚠ OCR [23]：判据抽成导出函数 —— 组件内联嵌套三元是本仓检查单明禁的。
  const lifecycleAction = lifecycleActionOf(member)
  const lifecycleButton = lifecycleAction !== null && onLifecycle !== undefined && member.tombstone !== true
    ? (
        <button
          type="button"
          className={CLASS.opsButton}
          data-sophia-action={lifecycleAction === 'suspend' ? 'suspend-member' : 'resume-member'}
          data-sophia-member={member.memberId}
          onClick={() => {
            void onLifecycle(member.memberId, lifecycleAction)
              .catch((error: unknown) => console.warn('[sophia] onLifecycle rejected:', error))
          }}
        >
          {lifecycleAction === 'suspend' ? t('suspendMember') : t('resumeMember')}
        </button>
      )
    : null
  // ── 结构对齐上游成员行（`css.memberRow` 的三列网格）─────────────────────
  //
  // 上游 `.memberRow`（`vendor/ActivityPanel.module.css`）是
  // `grid-template-columns: 46px minmax(0,1fr) auto`，三列依次是
  // 头像 / 姓名与角色 / 状态。索菲亚这一行原本是「横排胶囊」的自研皮肤，
  // 与上游不是同一套层次（字号、行高、右对齐都不同）—— 故这里改为直接吃它。
  //
  // ⚠ 头像本体**仍走** `MemberAvatar`（`sp-avatar` / `sp-avatar-fallback`），
  //   只用上游的 `css.memberAvatar` 做**容器**（它只有 position/display/flex，
  //   不含任何裁切属性）。上游的 `css.memberArt` 写的是 `object-fit: contain`，
  //   用它会把方形素材 letterbox 掉、破坏「只 cover + 圆形」这条素材硬约束
  //   （`scripts/check-t5-structure.mjs` 会逐条判 `.sp-avatar` 规则体）。
  const avatarSize = compact === true ? 32 : 44
  return (
    <div
      className={`${CLASS.memberCard} ${css.memberRow}${member.tombstone ? ` ${CLASS.memberCardTombstone}` : ''}`}
      data-sophia-member-card={member.memberId}
      data-sophia-lifecycle={member.lifecycle}
      data-sophia-tombstone={member.tombstone ? 'true' : 'false'}
      title={member.tombstone ? t('tombstoneHint') : `${member.position} · ${modelText}`}
    >
      {/* 第 1 列（上游给 46px）：头像本体 + 状态点同格（上游在头像右下角叠状态图）。 */}
      <span className={css.memberAvatar}>
        <MemberAvatar member={member} size={avatarSize} />
      </span>
      {/* 第 2 列（1fr）：姓名 +（角色 / 模型）。 */}
      <span className={css.memberInfo}>
        {/* ⚠ 这一行是**唯一**可读的姓名来源（头像上的字在 24px 下不可读）。
            上游 `css.memberName` 是 12.5px —— 仍满足「姓名 ≥ 12px」的下限。 */}
        <span className={`${CLASS.memberName} ${css.memberName}`} data-sophia-name>
          {member.displayName}
        </span>
        <span className={css.memberLine}>
          {member.tombstone
            ? (
                /* 墓碑徽章：上游同语义的是 `css.historicPill`（历史/归档条目的小药丸）。
                   类名 `CLASS.tombstoneBadge` 一并保留 —— 它是既有语义锚点。 */
                <span className={`${CLASS.tombstoneBadge} ${css.historicPill}`}>
                  {t('tombstoneBadge')}
                </span>
              )
            : (
                <span className={`${CLASS.memberPosition} ${css.memberRole}`}>
                  {t(lifecycleKey)}
                </span>
              )}
          {/* 模型：上游成员行是**常显**的一枚等宽小药丸（`css.memberModel`），
              索菲亚原来只把它放在 `title` 里（要悬停才看得到）。 */}
          <span className={`${css.memberModel} ${css.badgeCount}`}>{modelText}</span>
        </span>
      </span>
      {/* 第 3 列（auto）：状态点 + 运营按钮 —— 上游把状态放这一格的最右，
          索菲亚的换模/挂起按钮同属「本行的右侧动作」，故共处一格。 */}
      <span className={css.memberState}>
        <StateDot member={member} t={t} />
        {switchButton}
        {lifecycleButton}
      </span>
    </div>
  )
}

/** 进度分段条（FR-4.4）。 */
export function ProgressBar(props: {
  readonly tasks: readonly WireTask[]
  readonly t: Translate
}): ReactElement | null {
  const { tasks, t } = props
  const summary = summarizeProgress(tasks)
  if (summary.total === 0) {
    // 空态：上游同位置用的是 `css.taskEmpty`（9.5px、tertiary 的说明文字）。
    return (
      <div className={`${css.taskEmpty}`} data-sophia-progress="empty">
        {t('progressEmpty')}
      </div>
    )
  }
  return (
    <div
      className={css.progressOverview}
      data-sophia-progress="segments"
      data-sophia-total={summary.total}
      data-sophia-done={summary.done}
    >
      {/* ⚠ 分段条本体的**高度/底色**上游没有等价类（上游 `progressEmpty` 是
          "空条"，不是分段条）⇒ 保留 `CLASS.progressBar` 那几条骨架声明，
          但间距交给上游 `css.progressSegments`（gap 3px）——
          故 `styles.ts` 里那条规则**不再声明 gap**，否则本地后写的样式会把它压掉。 */}
      <div
        className={`${CLASS.progressBar} ${css.progressSegments}`}
        role="progressbar"
        aria-valuenow={summary.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('progressTitle')}
      >
        {summary.segments.map((segment) => {
          const statusKey = segment.statusKey
          const title = statusKey === null ? segment.rawStatus : t(statusKey)
          // ⚠ 颜色走**类名**而不是内联 style（OCR 复核 LOW）：`styles.ts` 的
          //    纪律是「所有颜色集中在主题变量里」，内联一份就在这里开了第二个
          //    颜色真相；换主题时会出现「同一块区域两套配色」。
          // ⚠ 用**显式映射表**（`SEGMENT_CLASS`）而不是 `CLASS[...]` 动态索引
          //    （OCR 复核 LOW）：动态索引一旦错过键就静默产出 `undefined`、
          //    渲染成 `class="sp-progress-segment undefined"`，是**无编译错误**的样式失效。
          const tone = segmentToneOf(segment)
          return (
            <span
              key={segment.taskId}
              className={`${CLASS.progressSegment} ${SEGMENT_CLASS[tone]}`}
              data-sophia-segment={segment.taskId}
              data-sophia-done={segment.done ? 'true' : 'false'}
              data-sophia-blocked={segment.blocked ? 'true' : 'false'}
              data-sophia-tone={tone}
              title={title}
            />
          )
        })}
      </div>
      {/* 摘要条：上游 `css.progressSummary`（浅底 + 圆角条），前置一枚
          `css.progressSummaryDot` 的强调点 —— 与上游进度概览同一形态。 */}
      <div className={`${css.progressSummary}`}>
        <span className={css.progressSummaryDot} aria-hidden="true" />
        <span>{t('progressSummary', { total: summary.total, done: summary.done })}</span>
      </div>
    </div>
  )
}

/** 进度分段的三种色调。 */
type SegmentTone = 'blocked' | 'done' | 'pending'

/** 色调 → 类名。**显式映射表**，不用 `CLASS[`…${tone}`]` 动态索引（见 `segmentToneOf`）。 */
const SEGMENT_CLASS: Readonly<Record<SegmentTone, string>> = {
  blocked: CLASS['progressSegment-blocked'],
  done: CLASS['progressSegment-done'],
  pending: CLASS['progressSegment-pending'],
}

/**
 * 判出一个分段该用哪种色调。
 *
 * 抽成函数：内联写就是 `blocked ? … : done ? … : …` 这种**嵌套三元**
 * （本仓检查单明确禁止，OCR 复核也点了这条）。
 *
 * 优先级：**阻塞 > 完成 > 待办** —— 一个被阻塞的任务即使状态已标 done，
 * 也应当显示成阻塞（那才是用户需要先看到的信息）。
 */
function segmentToneOf(segment: { readonly done: boolean; readonly blocked: boolean }): SegmentTone {
  if (segment.blocked) return 'blocked'
  if (segment.done) return 'done'
  return 'pending'
}

/**
 * 一个阻塞任务的「原因」文案。
 *
 * ⚠ `blockedBy` 可能是 `null` —— 而 `isBlockedTask` 把 `status === 'blocked'`
 * （无 `blockedBy`）也算作阻塞（那是刻意的：进度条与阻塞列表必须同一判据）。
 * 不兜底就会渲染一个**空白的「原因」格**：用户看到一行没有原因的阻塞。
 * ⇒ 没有 `blockedBy` 时回退到该任务**自己的状态文案**（它同样是可读信息）。
 *
 * 抽成具名函数而不是内联（OCR 复核 LOW [16]）：原写法在同一行里
 * 调了 `taskStatusKeyOf` **三次**，第三次还用 `as LocaleKey` 把刚落下的判空
 * 又绕开 —— 同一判据复制三份，改一处就会分叉。现在只算一次。
 */
export function blockerReasonOf(task: WireTask, t: Translate): string {
  if (task.blockedBy !== null) return task.blockedBy
  const statusKey = taskStatusKeyOf(task.status)
  return statusKey === null ? task.status : t(statusKey)
}

/** 阻塞提示（FR-4.4）：列出被阻塞的任务及其原因。 */
export function BlockerList(props: {
  readonly tasks: readonly WireTask[]
  readonly t: Translate
}): ReactElement | null {
  const { tasks, t } = props
  const blocked = blockersOf(tasks)
  if (blocked.length === 0) {
    return (
      <div className={`${css.taskEmpty}`} data-sophia-blockers="none">
        {t('blockersNone')}
      </div>
    )
  }
  // 任务行对齐上游 `css.taskDetail`（带边框的浅色小卡：头部一行 + 说明一行）。
  //
  // ⚠ 取舍要写明（OCR 纪律：判断句必须给依据）：索菲亚原来给阻塞行单独上
  //   「警示色」（`.sp-blocker-item` 的 `state-warn-label`），属于**自研皮肤**；
  //   上游任务行是中性色，警示语义靠行内那枚 `css.taskDetailBadge`（惊叹标记）
  //   与 `data-sophia-blockers="some"` / `data-sophia-blocker-count` 两个属性承载。
  //   ⇒ 「哪个任务被挡住」这件事仍可读、可断言，只是配色并入上游一套。
  return (
    <div
      className={`${CLASS.blockerList} ${css.planList}`}
      data-sophia-blockers="some"
      data-sophia-blocker-count={blocked.length}
    >
      <div className={`${css.progressTitle}`}>
        {t('blockerCount', { count: blocked.length })}
      </div>
      {blocked.map((task) => (
        <div className={`${CLASS.blockerItem} ${css.taskDetail}`} key={task.taskId} data-sophia-blocker={task.taskId}>
          <span className={css.taskDetailHead}>
            <span className={css.taskDetailBadge} aria-hidden="true">!</span>
            <span className={`${css.taskDetailSubject} ${css.badgeCount}`}>{task.title}</span>
          </span>
          {/* ⚠ `blockedBy` 可能是 `null` —— 而 `isBlockedTask` 把
              `status === 'blocked'`（无 blockedBy）也算作阻塞（那是刻意的：
              进度条与阻塞列表必须同一判据）。若不兜底，这里会渲染一个
              **空白的「原因」格**，用户看到一行没有原因的阻塞（OCR 复核 MEDIUM）。
              ⇒ 没有 `blockedBy` 时回退到该任务**自己的状态文案**（它同样是可读信息）。 */}
          <span className={`${css.taskDetailLine}`}>
            {blockerReasonOf(task, t)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * 活动面板（**可折叠**）。默认折叠 —— 任务书与 `DEVELOPMENT.md` 的
 * 「单页信息密度过高 → 活动面板默认折叠」是同一决定。
 */
export function ActivityPanel(props: {
  readonly team: WireTeam
  readonly t: Translate
  readonly initiallyOpen?: boolean | undefined
}): ReactElement | null {
  const { team, t, initiallyOpen } = props
  const { useState } = hooks()
  const [open, setOpen] = useState(initiallyOpen === true)
  const blocked = blockersOf(team.tasks).length
  const members = sortMembers(team.members)
  return (
    // 皮肤全部来自上游：外层 `css.planSection`（带边框圆角的浅色块 —— 上游
    // 所有分区都是这个语言），折叠头 `css.membersToggle`（上游成员区标题栏：
    // 整宽、浅底、圆角、10.5px 粗体 + 两端对齐），正文 `css.progressOverview`。
    <section
      className={`${CLASS.activity} ${css.planSection}`}
      data-sophia-activity={open ? 'open' : 'closed'}
    >
      {/* ⚠ 折叠头**就是**这个按钮，外面**不再**套一层 header 容器
          （OCR 复核 MEDIUM [13]）：上游 membersToggle 自带
          整宽 / 两端对齐 / 6px 8px 内边距，再套一层盒子既没有语义收益
          （button 自己的 aria-expanded 已经表达了折叠态），
          又会留下一个**没有任何规则**的空壳层 —— 那种层将来最容易被误当成
          "样式丢了"而去补一份重复的 CSS。
          `aria-expanded` / `aria-label` / `data-sophia-action` 全部原样保留。 */}
      <button
        type="button"
        className={`${CLASS.activityToggle} ${css.membersToggle}`}
        data-sophia-action="toggle-activity"
        aria-expanded={open}
        aria-label={open ? t('collapse') : t('expand')}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        <span className={`${CLASS.activityTitle} ${css.progressTitle}`}>{t('activityPanel')}</span>
        <span className={css.memberLine}>
          {/* 折叠时**仍然**报出阻塞数：折叠是为了省空间，不是为了把
              「这里卡住了」藏起来。带 `data-` 属性以便断言（与面板其它地方同口径）。
              徽章皮肤走上游 unreadPill（强调色小字）+ badgeCount（等宽数字）。 */}
          {blocked > 0
            ? (
                <span
                  className={`${CLASS.headerBlockers} ${css.unreadPill} ${css.badgeCount}`}
                  data-sophia-header-blockers={blocked}
                >
                  {t('blockerCount', { count: blocked })}
                </span>
              )
            : null}
          <span className={css.chevron} aria-hidden="true">{open ? '\u25be' : '\u25b8'}</span>
        </span>
      </button>
      {open
        ? (
            <div className={`${CLASS.activityBody} ${css.progressOverview}`}>
              <ProgressBar tasks={team.tasks} t={t} />
              {/* 成员区：上游 `css.members` 是**竖排**（每行一个成员），
                  与成员行 `css.memberRow` 的三列网格配套；
                  原来的 `sp-member-cards` 是横排胶囊，两者不是同一套形态。 */}
              <div className={`${CLASS.memberCards} ${css.members}`}>
                {members.map((member) => (
                  <MemberCard key={member.memberId} member={member} t={t} compact />
                ))}
              </div>
              <BlockerList tasks={team.tasks} t={t} />
            </div>
          )
        : null}
    </section>
  )
}

/** 频道切换列表（侧栏）。 */
export function ChannelList(props: {
  readonly team: WireTeam
  readonly t: Translate
  readonly activeChannelId: string | null
  readonly onSelect: (channelId: string) => void
}): ReactElement | null {
  const { team, t, activeChannelId, onSelect } = props
  if (team.channels.length === 0) {
    return <div className={CLASS.emptyHint} data-sophia-channels="empty">{t('emptyChannels')}</div>
  }
  return (
    <div className={CLASS.threadList} data-sophia-channels={team.channels.length}>
      {team.channels.map((channel) => (
        <button
          key={channel.channelId}
          type="button"
          className={`${CLASS.channelItem}${channel.channelId === activeChannelId ? ` ${CLASS.channelItemActive}` : ''}`}
          data-sophia-channel={channel.channelId}
          aria-current={channel.channelId === activeChannelId ? 'page' : undefined}
          onClick={() => {
            onSelect(channel.channelId)
          }}
        >
          {channel.title}
        </button>
      ))}
    </div>
  )
}

/**
 * 线程列表。
 *
 * 刻意**不接 `t`**：这一块只有线程标题与指派者名，两者都是数据
 * （标题来自账本、名字来自成员表），没有任何需要翻译的字面量。
 * 接一个用不到的 `t` 是"看着齐整"的噪音，且会让读者以为这里漏了文案。
 */
export function ThreadList(props: {
  readonly channel: WireChannel
  readonly team: WireTeam
  readonly activeThreadId: string | null
  readonly onSelect: (threadId: string | null) => void
}): ReactElement | null {
  const { channel, team, activeThreadId, onSelect } = props
  if (channel.threads.length === 0) return null
  return (
    <div className={CLASS.threadList} data-sophia-threads={channel.threads.length}>
      {channel.threads.map((thread) => {
        const assignee = displayNameIn(team, thread.assigneeMemberId)
        return (
          <button
            key={thread.threadId}
            type="button"
            className={`${CLASS.channelItem}${thread.threadId === activeThreadId ? ` ${CLASS.channelItemActive}` : ''}`}
            data-sophia-thread={thread.threadId}
            onClick={() => {
              onSelect(thread.threadId === activeThreadId ? null : thread.threadId)
            }}
          >
            <span className={CLASS.threadTitle}>{thread.title}</span>
            {assignee === null ? null : <span className={CLASS.threadAssignee}>@{assignee}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 消息流。
 *
 * ⚠ **频道也要传下去**（OCR 复核 HIGH）：`messagesOfTeam` 现在按
 * `channelId` + `threadId` 双维过滤，切频道时消息流才跟着换。
 * 只传 `threadId` 会让切频道后仍显示上一个频道的消息（串台）。
 */
export function MessageStream(props: {
  readonly team: WireTeam
  readonly t: Translate
  readonly channelId: string | null
  readonly threadId: string | null
}): ReactElement | null {
  const { team, t, channelId, threadId } = props
  const messages = messagesOfTeam(team, channelId, threadId)
  if (messages.length === 0) {
    return (
      <div className={CLASS.empty} data-sophia-messages="empty">
        <div className={CLASS.emptyTitle}>{t('emptyMessages')}</div>
        <div className={CLASS.emptyHint}>{t('emptyMessagesHint')}</div>
      </div>
    )
  }
  const index = memberIndex(team)
  return (
    <div className={CLASS.messages} data-sophia-messages={messages.length}>
      {messages.map((message) => {
        const sender = index.get(message.senderMemberId)
        const clock = formatClock(message.occurredAt)
        return (
          <article className={CLASS.message} key={message.messageId} data-sophia-message={message.messageId}>
            <div className={CLASS.messageHead}>
              {/* 如实回退：认不出发送者时显示「未知成员」，而不是空白或 id。 */}
              <span className={CLASS.messageSender}>
                {sender?.displayName ?? t('senderUnknown')}
              </span>
              {clock === '' ? null : <span className={CLASS.messageTime}>{clock}</span>}
            </div>
            <div className={CLASS.messageBody}>{message.body}</div>
          </article>
        )
      })}
    </div>
  )
}

/** 侧栏：频道列表 + 当前频道的线程。 */
export function TeamSidebar(props: {
  readonly team: WireTeam
  readonly t: Translate
  readonly activeChannelId: string | null
  readonly onSelectChannel: (channelId: string) => void
  readonly activeThreadId: string | null
  readonly onSelectThread: (threadId: string | null) => void
  readonly onCreateChannel?: ((title: string) => Promise<void>) | undefined
}): ReactElement | null {
  const { team, t, activeChannelId, onSelectChannel, activeThreadId, onSelectThread, onCreateChannel } = props
  const { useState } = hooks()
  const [channelTitle, setChannelTitle] = useState('')
  const channel = team.channels.find((entry) => entry.channelId === activeChannelId) ?? null
  return (
    <nav className={CLASS.sidebar} aria-label={t('channelMembers')}>
      <div className={CLASS.sidebarSection}>
        <div className={CLASS.sidebarSectionTitle}>{t('channelMembers')}</div>
        <ChannelList team={team} t={t} activeChannelId={activeChannelId} onSelect={onSelectChannel} />
        {onCreateChannel === undefined
          ? null
          : (
              <div className={CLASS.opsRow}>
                <input
                  className={CLASS.opsInput}
                  data-sophia-input="channel-title"
                  placeholder={t('channelTitlePlaceholder')}
                  value={channelTitle}
                  onChange={(event) => {
                    setChannelTitle(event.currentTarget.value)
                  }}
                />
                <button
                  type="button"
                  className={CLASS.opsButton}
                  data-sophia-action="create-channel"
                  disabled={channelTitle.trim() === ''}
                  onClick={() => {
                    const title = channelTitle.trim()
                    if (title === '') return
                    setChannelTitle('')
                    void onCreateChannel(title)
                      .catch((error: unknown) => console.warn('[sophia] onCreateChannel rejected:', error))
                  }}
                >
                  {t('createChannel')}
                </button>
              </div>
            )}
      </div>
      {channel === null
        ? null
        : (
            <div className={CLASS.sidebarSection}>
              <div className={CLASS.sidebarSectionTitle}>{t('messageStream')}</div>
              <ThreadList
                channel={channel}
                team={team}
                activeThreadId={activeThreadId}
                onSelect={onSelectThread}
              />
            </div>
          )}
    </nav>
  )
}

/**
 * 成员名册（**完整的成员卡**：头像 + 显示名 + 状态点 + 模型切换入口）。
 *
 * 与 `ActivityPanel` 里那份 `compact` 胶囊的区别：这里带换模按钮，
 * 因为换模是**人的操作**，属主界面；活动面板是**只读概览**。
 */
export function MemberRoster(props: {
  readonly members: readonly WireMember[]
  readonly t: Translate
  readonly onSwitchModel?: ((member: WireMember) => void) | undefined
  readonly onLifecycle?: ((memberId: string, action: 'suspend' | 'resume') => Promise<void>) | undefined
  readonly onAddMember?: ((position: string) => Promise<void>) | undefined
}): ReactElement | null {
  const { members, t, onSwitchModel, onLifecycle, onAddMember } = props
  const { useState } = hooks()
  const [positionInput, setPositionInput] = useState('')
  // ⚠ OCR HIGH：**不再** `members.length === 0 → return null` —— 空名册
  //（新团建好、成员事实在前）是合法状态，整体 return 会连同下方的加成员
  // 表单一并跳过 ⇒ 首名成员在 UI 上永远加不进去（onAddMember 形同虚设）。
  const isEmpty = members.length === 0
  const online = onlineCount(members)
  return (
    <section data-sophia-roster={members.length}>
      {/* 名册标题：上游 `css.sectionHead`（两端对齐的一行）+ `css.sectionTitle`
          （11px 粗体次级文字）+ `css.memberCount`（10.5px 三级文字，等宽数字）。
          ⚠ 这里**不再**复用 `CLASS.sidebarSectionTitle`：那是侧栏分区标题的自研皮肤，
              两者叠在一起时本地后写的规则会把它压回旧字号，
          等于换了类还是旧视觉（"换了名字没换样式"正是本次要避免的）。 */}
      <div className={css.sectionHead}>
        <span className={css.sectionTitle}>{t('memberCount', { count: members.length })}</span>
        <span className={`${css.memberCount} ${css.badgeCount}`}>
          {isEmpty ? null : t('onlineCount', { count: online })}
        </span>
      </div>
      {isEmpty ? null : (
        <div className={`${CLASS.memberCards} ${css.members}`}>
        {sortMembers(members).map((member) => (
          <MemberCard
            key={member.memberId}
            member={member}
            t={t}
            onSwitchModel={onSwitchModel}
            onLifecycle={onLifecycle}
          />
        ))}
        </div>
      )}
      {onAddMember === undefined
        ? null
        : (
            <div className={CLASS.opsRow}>
              <input
                className={CLASS.opsInput}
                data-sophia-input="member-position"
                placeholder={t('memberPositionPlaceholder')}
                value={positionInput}
                onChange={(event) => {
                  setPositionInput(event.currentTarget.value)
                }}
              />
              <button
                type="button"
                className={CLASS.opsButton}
                data-sophia-action="add-member"
                disabled={positionInput.trim() === ''}
                onClick={() => {
                  const position = positionInput.trim()
                  if (position === '') return
                  setPositionInput('')
                  void onAddMember(position)
                    .catch((error: unknown) => console.warn('[sophia] onAddMember rejected:', error))
                }}
              >
                {t('addMember')}
              </button>
            </div>
          )}
    </section>
  )
}

/**
 * 面板主体（单个团的完整视图）：活动面板 + 消息流。
 *
 * 把选择状态放在这里（而不是 index.ts 的挂载层）：面板可能被 keyed slot
 * 多份挂载，各份的选择必须**互不影响**。
 */
/**
 * 把一个「可能已失效」的线程选择解析成**当前频道里真实存在**的那个线程。
 *
 * ## 存在理由（OCR 复核 MEDIUM 抓到的真实缺陷）
 *
 * `TeamPanel` 把「选中的频道」与「选中的线程」存成**两份独立 state**。
 * 视图重读后频道集合可能变化，于是会出现两种失效：
 * 1. 选中的频道被移除 ⇒ 频道回退到首个（已在上面处理）；
 * 2. **线程 id 仍指着别处** —— 它属于被移除的那个频道。
 *
 * 第 2 种若不管：`messagesOfTeam` 会先按 `channelId` 过滤，于是消息流
 * 渲染成**空**、侧栏也没有选中项 —— 正是「看起来像这个团没有消息」，
 * 属于本仓反复要避免的「看起来正常、内容却是错的」。
 *
 * 抽成**导出的纯函数**（而不是内联在组件里）是为了**能被真的测**：
 * 本仓没有 jsdom，`useState` 的更新在 SSR 下跑不到，内联写法只能靠读代码相信。
 * 这个函数把判据固定在一个可直接调用、可用变异验证的地方。
 *
 * @param channel - 已解析出的当前频道（`null` = 没有频道）。
 * @param activeThreadId - 用户此前选择的线程 id（可能是失效的）。
 * @returns 该线程**存在且属于该频道**时返回它，否则 `null`（视为未选线程）。
 */
export function resolveActiveThread(
  channel: WireChannel | null,
  activeThreadId: string | null,
): WireThread | null {
  if (channel === null || activeThreadId === null) return null
  return channel.threads.find((entry) => entry.threadId === activeThreadId) ?? null
}

export function TeamPanel(props: {
  readonly team: WireTeam
  readonly t: Translate
  readonly onSwitchModel?: ((member: WireMember) => void) | undefined
  readonly onLifecycle?: ((memberId: string, action: 'suspend' | 'resume') => Promise<void>) | undefined
  readonly onCreateChannel?: ((title: string) => Promise<void>) | undefined
  readonly onAddMember?: ((position: string) => Promise<void>) | undefined
}): ReactElement | null {
  const { team, t, onSwitchModel, onLifecycle, onCreateChannel, onAddMember } = props
  const { useState } = hooks()
  const firstChannel = team.channels[0]?.channelId ?? null
  const [selectedChannelId, setActiveChannelId] = useState<string | null>(firstChannel)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  // ⚠ **失效的选择要回退**（OCR 复核 MEDIUM）：重读视图后频道集合可能变了，
  //    而 `useState` 记的旧 id 不会自己跟上。不兜底的话 `channel` 是 `null`
  //    ⇒ 侧栏线程列表与消息流**双双渲染成空**，看起来像「这个团没有消息」。
  //    这里按「选中项还在不在」决定用哪个：在就尊重用户选择，不在就回退首个。
  //    （调用方另有 `key={team.teamId}`，两者一起保证跨团与团内变更都正确。）
  const selected = team.channels.find((entry) => entry.channelId === selectedChannelId)
  const channel = selected
    ?? team.channels.find((entry) => entry.channelId === firstChannel)
    ?? null
  // ⚠ **线程也要跟着一起回退**（OCR 复核 MEDIUM）：上一处只修了频道。
  //   判据收在 `resolveActiveThread` 里（纯函数，可单测）。
  const thread = resolveActiveThread(channel, activeThreadId)
  return (
    <>
      {/* 团队卡头部：上游 `css.panelHead`（44px 最小高 / 两端对齐 / 下边框）
          + `css.teamHead`（左侧留 10px 间距的标题行）+ `css.teamName`
          （13px 粗体、超长省略）+ `css.teamStats`（等宽数字的统计）。
          ⚠ `panelHead` 自带 `cursor: grab` 与 `touch-action: none` —— 那是给
              **可拖拽浮层**用的；索菲亚的面板挂在宿主固定 slot 里、不可拖拽，
              留着那个光标等于用一个做不到的操作暗示用户。`styles.ts` 里对
              `sp-header` 保留了**这两条**显式覆盖，其余全部交给上游。 */}
      <header className={`${CLASS.header} ${css.panelHead} ${css.teamHead}`}>
        <span className={`${CLASS.headerTitle} ${css.teamName}`}>{team.name}</span>
        <span className={`${CLASS.headerMeta} ${css.teamStats} ${css.badgeCount}`}>
          {t('messageCount', { count: team.messages.length })}
        </span>
      </header>
      <ActivityPanel team={team} t={t} />
      <div className={CLASS.body}>
        <TeamSidebar
          team={team}
          t={t}
          activeChannelId={channel === null ? null : channel.channelId}
          onSelectChannel={(channelId) => {
            setActiveChannelId(channelId)
            setActiveThreadId(null)
          }}
          activeThreadId={thread === null ? null : thread.threadId}
          onSelectThread={setActiveThreadId}
          {...(onCreateChannel === undefined ? {} : { onCreateChannel })}
        />
        <div className={CLASS.main}>
          <MemberRoster
            members={team.members}
            t={t}
            onSwitchModel={onSwitchModel}
            {...(onLifecycle === undefined ? {} : { onLifecycle })}
            {...(onAddMember === undefined ? {} : { onAddMember })}
          />
          <MessageStream
            team={team}
            t={t}
            channelId={channel === null ? null : channel.channelId}
            threadId={thread === null ? null : thread.threadId}
          />
        </div>
      </div>
    </>
  )
}
