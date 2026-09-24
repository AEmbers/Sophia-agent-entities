/**
 * 上游 `TeamMessage.tsx`（477 行 / 29.6KB）的索菲亚版 —— **消息行**。
 *
 * ## ⚠ 先读这一段：本文件与上游的关系
 *
 * 主人的验收口径是「UI 整份复制（不是参考着重写）」。本文件在**能照抄的每一处都照抄了**：
 * `messageRow` / `messageIdentity` / `messageIdentityImage` / `messageBody` /
 * `nameRow` / `messageTime` / `messageText` / `messageMarkdown` / `messageClamp` /
 * `messageExpand` / `mentionsRow` / `mention` / `refLink` / `attachmentStrip` 等
 * **全部类名、DOM 层级、`data-human` / `data-grouped` 属性逐字一致**；
 * `planMessageBody` 的渲染分支（`inline` / `literal` / `markdown`）、
 * 折叠控制、Markdown 后处理（`markdownProseTextNodes` /
 * `markdownStyledRefCodeElements` / `renderResolvedMarkdownText` /
 * `resolvedTaskRefButton` 等，**全部逐字照抄**）、ref chip 的
 * 「宿主确认了才是链接」规则也逐字保留。
 *
 * ## 索菲亚移植点（**只允许这几类差异**）
 *
 * | 上游 | 索菲亚 | 依据 |
 * |---|---|---|
 * | `import { Fragment, memo, useCallback, … } from 'react'` | `hooks()` / `react()` / `memoize()` 惰性取 | 顶层值导入会多一条顶层模块加载调用，撞红「模块加载调用 ≤ 2」的既有断言（见 `../../react-runtime.ts` 文件头对照表）。⚠ 本行刻意**不写出那个字面量**（`require` + 左括号）：那条断言是**文本级**的，注释里写了也会被计入。 |
 * | `import { MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'` | `primitives.MarkdownText` / `primitives.Modal`（`../bridge.ts` 的惰性代理） | 同上（该代理是索菲亚为「上游 UI 少改」设的唯一通道） |
 * | `memo(fn)` | `memoize(fn)`（`../../react-runtime.ts`） | `memo` 在**模块求值期**就被调用 ⇒ 顶层 require；`memoize` 把比较推迟到首次渲染 |
 * | `useAvatarImage`（`./avatar-image.ts`） | **改用索菲亚素材**：`resolveAvatarUrl`（`../../../avatar-paths.ts`） | 主人的硬约束：头像走索菲亚素材体系。上游那个模块画的是「从它自己的 URL 取主人的脸」，索菲亚**有**真头像素材（`assets/members/out-512/…`）⇒ 该模块**不移植** |
 * | 类型来自 `@wowyuarm/dsh-agent-team/types` | `./agent-team-types.ts` | 上游包在索菲亚不存在 |
 *
 * ## 头像的处置（**结构照抄 + 素材换源**）
 *
 * 上游在第 177–179 行分两支：无图 ⇒ `.messageIdentity`（色相圆 + 首字），
 * 有图 ⇒ `<img className={css.messageIdentityImage}>`。两支**都保留**，
 * 只把 `src` 的来源从「上游头像 URL」换成索菲亚的
 * `resolveAvatarUrl({ avatarPath })` —— 而 `.messageIdentityImage` 的规则体
 * （`conversation.module.css`）本来就只做 `border-radius: 50%` + `object-fit: cover`
 * 加尺寸，与索菲亚 `styles.ts` 的 `.sp-avatar` **同一口径**（都不做二次裁切），
 * 所以这次换源**不需要**改任何一条样式规则。
 *
 * 失败回落沿用索菲亚 `TeamMemberAvatarImage.tsx` 修过的那条判据
 * （**按 URL 记忆**失败，不是永久布尔）：`tests/client-sources.spec.ts`
 * 断言不得出现 `const [failed, setFailed] = useState(false)` 那种写法。
 *
 * ## 附件（**结构照抄，索菲亚恒无数据**）
 *
 * `attachmentStrip` / `attachmentThumb` / `attachmentChip` / `attachmentT` /
 * `attachmentZoom` 与整个 `TeamAttachmentStrip` / `TeamAttachment` 逐字照抄。
 * 但索菲亚的线格式 `WireMessage`（`../../wire.ts`）只有 `body`，**没有 attachments**，
 * 且 `src/host.ts` 没有 `getAttachment` 路由 ⇒ `attachments` 恒 `undefined`、
 * `loadAttachment` 恒不传 ⇒ 这根 strip 在索菲亚**永远不渲染**。
 * 保留它是为了让宿主补上附件面后**接线即可用**。
 *
 * @module @sophia/core/client/vendor/team/TeamMessage
 */

import type { ReactElement, ReactNode, CSSProperties } from 'react'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { hooks, memoize, react } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import { resolveAvatarUrl } from '../../../avatar-paths.ts'
import type {
  AgentTeamChannelRef, AgentTeamMemberId, AgentTeamMessageAttachment, AgentTeamTaskRef, AgentTeamThreadRef,
} from './agent-team-types.ts'
import type { TeamConversationProps } from './slots.ts'
import type { ResolvedMemberRef } from './refs.ts'
import { cachedAttachmentDataUrl, formatByteSize, loadAttachmentDataUrl } from './attachment-preview.ts'
import { cachedResolvedTaskRef, resolveUnknownTaskRefs, useResolvedTaskRefVersion, type ResolvedTaskRef } from './refs.ts'
import { cachedResolvedThreadRef, resolveUnknownThreadRefs, useResolvedThreadRefVersion, type ResolvedThreadRef } from './refs.ts'
import { formatMessageTime, isSingleBrandedRef, memberHue, planMessageBody, shouldClampMessage, splitBrandedRefs, splitMentionNames, type MentionHandle } from './team-formatters.ts'
import css from './conversation.module.css'

export interface TeamMessageProps {
  readonly senderName: string
  readonly memberId: AgentTeamMemberId
  /** Human input stays literal text; Agent output renders as Markdown. */
  readonly human: boolean
  readonly body: string
  readonly occurredAt?: string
  /** Structured mention handles of this Message; the only names that render as chips. */
  readonly mentionNames?: readonly MentionHandle[]
  readonly senderTitle?: string
  /** Continuation of one same-sender run: suppress repeated identity chrome. */
  readonly grouped?: boolean
  /** Continuation rows that carry their own footer chip render the time so the
      hairline-separated entry stays self-identifying. */
  readonly showGroupedTime?: boolean
  readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined
  /**
   * The Human's uploaded avatar; only the Human's own row draws it, and absent
   * or undecodable bytes draw the initial on the business-tinted chip.
   *
   * ⚠ 索菲亚移植点：索菲亚**没有人类成员这一维**（主人不是名册里的成员，
   * 见 AGENTS.md 的「唯一主人」模型与 `slots.ts` 剥掉 `humanName` 的理由）
   * ⇒ 这个 prop 保留上游形状但**恒不传**。代理成员的头像走下面的 `avatarPath`。
   */
  readonly avatarUrl?: string | undefined
  /**
   * 头像的仓库相对路径（索菲亚 `WireMember.avatarPath`）。
   *
   * 索菲亚**新增**的 prop（上游没有）：上游只有「主人自己的脸」这一个图片来源，
   * 代理成员画的是色相圆 + 首字。索菲亚有**全体成员**的真头像素材
   * （`assets/members/out-512/…`，见 `../../../avatar-paths.ts`）⇒ 每个座都能画真脸。
   * 白名单校验在 `resolveAvatarUrl` 内；越界路径返回 `null` ⇒ 回落首字。
   */
  readonly avatarPath?: string | undefined
  /** Cache readback for thumbnails; absent on surfaces without the remotes. */
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
  /** Resolve a branded ref found in the body; absent surfaces render refs as plain text. */
  readonly onOpenRef?: ((ref: string) => void) | undefined
  /** Host lookup turning task refs into human-facing numbers; absent keeps raw refs. */
  readonly onResolveTaskRefs?: ((taskRefs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>) | undefined
  /** Host lookup turning thread refs into titled chips; absent keeps raw refs. */
  readonly onResolveThreadRefs?: ((threadRefs: readonly AgentTeamThreadRef[]) => Promise<readonly ResolvedThreadRef[]>) | undefined
  /** Roster name for one authored channel ref; absent or unknown keeps plain text. */
  readonly channelNameOf?: ((ref: AgentTeamChannelRef) => string | undefined) | undefined
  /** Roster facts for one authored member ref; absent or unknown keeps plain text. */
  readonly memberOf?: ((ref: AgentTeamMemberId) => ResolvedMemberRef | undefined) | undefined
  /** Agent-card session jump for member chips; absent renders them as plain text. */
  readonly onOpenMemberSession?: ((sessionId: SessionId) => void) | undefined
  readonly children?: ReactNode
}

/**
 * One chat message row with identity chrome and sender-appropriate rendering.
 *
 * Memoized because a timeline row is rendered by the page that owns the whole
 * Thread: the Task-ref subscription below lives inside this component, so
 * skipping a render here never detaches it. Callers must therefore keep the
 * props they derive per render (mention names, ref callbacks) identity-stable.
 *
 * ⚠ 索菲亚移植点：上游写 `memo(function TeamMessage(…) {…})` —— `memo` 在模块求值期
 * 被调用 ⇒ 顶层 require（见 `../../react-runtime.ts` 的 `memoize` 说明）。
 * 这里换成 `memoize(...)`：比较关系**照旧建立**，只是推迟到首次渲染。
 */
export const TeamMessage = memoize(function TeamMessage({ senderName, memberId, human, avatarUrl, avatarPath, body, occurredAt, mentionNames, senderTitle, grouped, showGroupedTime, attachments, loadAttachment, t, onOpenRef, onResolveTaskRefs, onResolveThreadRefs, channelNameOf, memberOf, onOpenMemberSession, children }: TeamMessageProps): ReactElement {
  const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = hooks()
  const { Fragment } = react()
  const avatarStyle = human ? undefined : { '--team-avatar-hue': memberHue(memberId) } as CSSProperties
  /**
   * 头像来源（**索菲亚移植点**，见文件头「头像的处置」）。
   *
   * 上游是 `useAvatarImage(human ? avatarUrl : undefined)` —— 只给主人画脸、
   * 图从上游自己的 URL 取。索菲亚改成：
   * - 主人那一行仍认 `avatarUrl`（上游语义保留，虽然索菲亚恒不传）；
   * - 其余每一行认 `avatarPath`（索菲亚的真头像素材）。
   *
   * 两条都走 `resolveAvatarUrl`：它是**同一条白名单判据**
   * （`../../../avatar-paths.ts`，宿主半的 `/api/sophia/avatar` 也重跑它）。
   */
  const identitySrc = human
    ? (avatarUrl === undefined || avatarUrl === '' ? null : avatarUrl)
    : resolveAvatarUrl(avatarPath === undefined ? {} : { avatarPath })
  /**
   * ⚠ 失败标记**按 URL 记忆**（不是永久布尔）—— 与 `TeamMemberAvatarImage.tsx`
   * 修过的那条判据同源（见那个文件的注释）：永久布尔会让一次 404 把该成员
   * 永久钉在首字上。回归判据：`tests/client-sources.spec.ts` 断言
   * `failedUrl === url`，且不得出现 `useState(false)` 那种写法。
   */
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const identityImage = {
    src: identitySrc === null || failedUrl === identitySrc ? undefined : identitySrc,
    failed: (): void => { if (identitySrc !== null) setFailedUrl(identitySrc) },
  }
  // Literal bodies carry mention chips inline — Human input always, and
  // plain-prose Agent bodies where literal rendering loses nothing. Rich
  // Markdown keeps unmatched structured mentions in the trailing row.
  // The stored body carries machine-facing `[attachment] <path>` prompt lines;
  // humans see the attachment strip rendered from the message metadata instead.
  // One pure plan resolves the stored body into the rendering branch, the
  // trailing fallback rows, and the literal Task/Thread refs that resolve in place.
  const plan = planMessageBody(body, { human, ...(mentionNames === undefined ? {} : { mentionNames }), canOpenRefs: onOpenRef !== undefined })
  const displayBody = plan.displayBody
  const { richAgentBody } = plan
  // Resolved refs re-label once the Host lookup lands; the version tokens
  // refresh literal links and rendered Markdown prose.
  const taskRefVersion = useResolvedTaskRefVersion()
  const threadRefVersion = useResolvedThreadRefVersion()
  const bodyTaskRefs = plan.taskRefs
  const bodyTaskRefKey = bodyTaskRefs.join(',')
  const bodyThreadRefs = plan.threadRefs
  const bodyThreadRefKey = bodyThreadRefs.join(',')
  useEffect(() => {
    if (onResolveTaskRefs !== undefined && bodyTaskRefKey !== '') void resolveUnknownTaskRefs(bodyTaskRefs, onResolveTaskRefs)
    if (onResolveThreadRefs !== undefined && bodyThreadRefKey !== '') void resolveUnknownThreadRefs(bodyThreadRefs, onResolveThreadRefs)
  }, [onResolveTaskRefs, onResolveThreadRefs, bodyTaskRefKey, bodyThreadRefKey, taskRefVersion, threadRefVersion])
  const taskLabel = useCallback((taskNumber: number): string => t?.('taskLabel', { number: taskNumber }) ?? `Task #${taskNumber}`, [t])
  // Thread chips carry the cited Thread's opening-line gist, so one taskless
  // Thread no longer reads exactly like the next. Unresolvable refs never
  // reach this label — they stay plain text (see renderRefs).
  const threadChipLabel = useCallback((title: string): string => {
    const base = t?.('threadLabel') ?? 'Thread'
    return title === '' ? base : `${base} · ${title}`
  }, [t])
  // Channel chips name the cited Channel; member chips name the cited Member
  // with a handle — deliberately distinct from `@mention` chips, which notify.
  const channelChipLabel = useCallback((name: string): string => t?.('channelLabel', { name }) ?? `Channel · ${name}`, [t])
  const memberChipLabel = useCallback((name: string): string => t?.('memberLabel', { name }) ?? `Member · @${name}`, [t])
  // Markdown chrome (code-copy buttons, footnotes heading) is locale copy the
  // cordis-free primitive receives via props. Stable per locale revision — a
  // fresh object per render would rebuild the component table every chunk.
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t?.('copyCode') ?? 'Copy', copiedLabel: t?.('copiedCode') ?? 'Copied' },
    footnotes: t?.('markdownFootnotes') ?? 'Footnotes',
  }), [t])
  // Long bodies start clamped behind the expand control. The default derives
  // from the body alone; the toggle itself is per-mount view state nothing
  // persists.
  const [expanded, setExpanded] = useState(false)
  const clampable = shouldClampMessage(displayBody)
  const clamped = clampable && !expanded
  const markdownRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = markdownRef.current
    if (!richAgentBody || root === null || onOpenRef === undefined) return
    const textNodes = markdownProseTextNodes(root)
    const styledRefCodes = markdownStyledRefCodeElements(root)
    const taskRefs = [...new Set([...textNodes.map(node => node.data), ...styledRefCodes.map(code => code.textContent ?? '')]
      .flatMap(text => splitBrandedRefs(text)
        .filter(segment => segment.ref?.startsWith('task:') === true)
        .map(segment => segment.ref as AgentTeamTaskRef)))]
    const threadRefs = [...new Set([...textNodes.map(node => node.data), ...styledRefCodes.map(code => code.textContent ?? '')]
      .flatMap(text => splitBrandedRefs(text)
        .filter(segment => segment.ref?.startsWith('thread:') === true)
        .map(segment => segment.ref as AgentTeamThreadRef)))]
    if (onResolveTaskRefs !== undefined && taskRefs.length > 0) void resolveUnknownTaskRefs(taskRefs, onResolveTaskRefs)
    if (onResolveThreadRefs !== undefined && threadRefs.length > 0) void resolveUnknownThreadRefs(threadRefs, onResolveThreadRefs)
    for (const code of styledRefCodes) renderResolvedMarkdownCodeRef(code, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf)
    for (const node of textNodes) renderResolvedMarkdownText(node, mentionNames ?? [], taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf)
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-task-ref]')) {
      const taskRef = button.dataset.taskRef as AgentTeamTaskRef | undefined
      const hit = taskRef === undefined ? undefined : cachedResolvedTaskRef(taskRef)
      if (taskRef !== undefined && hit !== undefined) button.textContent = taskLabel(hit.taskNumber)
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-thread-ref]')) {
      const threadRef = button.dataset.threadRef as AgentTeamThreadRef | undefined
      const hit = threadRef === undefined ? undefined : cachedResolvedThreadRef(threadRef)
      if (threadRef !== undefined && hit !== undefined) button.textContent = threadChipLabel(hit.title)
    }
  }, [richAgentBody, onOpenRef, onResolveTaskRefs, onResolveThreadRefs, taskRefVersion, threadRefVersion, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf, mentionNames])
  useEffect(() => {
    const root = markdownRef.current
    if (!richAgentBody || root === null || onOpenRef === undefined) return
    const openTask = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest('button[data-ref], button[data-task-ref], button[data-thread-ref], button[data-member-session]')
      if (button === null || !root.contains(button)) return
      if (button instanceof HTMLElement) {
        // Member chips carry their session, not a Team ref: the same jump
        // the agent card performs. Every other chip resolves to onOpenRef.
        const sessionId = button.dataset.memberSession as SessionId | undefined
        if (sessionId !== undefined) {
          onOpenMemberSession?.(sessionId)
          return
        }
        const ref = button.dataset.ref ?? button.dataset.taskRef ?? button.dataset.threadRef
        if (ref !== undefined) onOpenRef(ref)
      }
    }
    root.addEventListener('click', openTask)
    return () => { root.removeEventListener('click', openTask) }
  }, [richAgentBody, onOpenRef, onOpenMemberSession])
  const bodyNode = plan.render === 'inline' && plan.inline !== undefined
    ? <div className={css.messageText}>
        {plan.inline.segments.map((segment, index) => segment.mention
          ? <span key={index} className={css.mention}>{segment.text}</span>
          : <Fragment key={index}>{renderRefs(segment.text, onOpenRef, onOpenMemberSession, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf)}</Fragment>)}
      </div>
    : plan.render === 'literal'
      ? <div className={css.messageText}>{onOpenRef === undefined ? displayBody : renderRefs(displayBody, onOpenRef, onOpenMemberSession, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf)}</div>
      : <div ref={markdownRef} className={css.messageMarkdown}><primitives.MarkdownText key={`${displayBody}:${onOpenRef === undefined ? 'literal' : 'refs'}`} text={displayBody} labels={markdownLabels} /></div>
  return (
    <article className={css.messageRow} data-human={human || undefined} data-grouped={grouped || undefined}>
      {identityImage.src === undefined
        ? <div className={css.messageIdentity} data-avatar="initial" data-sophia-avatar="fallback" style={avatarStyle} aria-hidden="true">{senderName.replace('@', '').slice(0, 1).toUpperCase()}</div>
        : <img className={css.messageIdentityImage} data-avatar="image" data-sophia-avatar="image" src={identityImage.src} alt="" aria-hidden="true" onError={identityImage.failed} />}
      <div className={css.messageBody}>
        {(!grouped || showGroupedTime === true) && (
          <div className={css.nameRow}>
            {!grouped && <strong {...(senderTitle === undefined ? {} : { title: senderTitle })}>{senderName}</strong>}
            {occurredAt !== undefined && <span className={css.messageTime}>{formatMessageTime(occurredAt)}</span>}
          </div>
        )}
        {/* The wrapper stays mounted for every clampable body and only swaps
            its class: appearing/disappearing around bodyNode would remount the
            Markdown subtree and wipe the post-render ref/mention chips that the
            layout effects painted into it. */}
        {clampable ? <div className={clamped ? css.messageClamp : undefined}>{bodyNode}</div> : bodyNode}
        {clampable && (
          <button type="button" className={css.messageExpand} data-message-expand="true" aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
            {expanded ? (t?.('collapseMessage') ?? 'Show less') : (t?.('expandMessage') ?? 'Show more')}
          </button>
        )}
        {(plan.fallbackNames.length > 0 || plan.fallbackRefs.length > 0) && (
          <div className={css.mentionsRow}>
            {plan.fallbackNames.map(name => <span key={name} className={css.mention}>@{name}</span>)}
            {plan.fallbackRefs.map(ref => {
              const resolved = cachedResolvedTaskRef(ref as AgentTeamTaskRef)
              const label = resolved !== undefined && ref.startsWith('task:') ? taskLabel(resolved.taskNumber) : ref
              return <button key={ref} type="button" className={css.refLink} title={ref} onClick={() => { onOpenRef!(ref) }}>{label}</button>
            })}
          </div>
        )}
        {attachments !== undefined && attachments.length > 0 && <TeamAttachmentStrip
          attachments={attachments}
          {...(loadAttachment === undefined ? {} : { loadAttachment })}
          {...(t === undefined ? {} : { t })}
        />}
        {children}
      </div>
    </article>
  )
})

/** Text nodes that Markdown rendered as prose rather than code or a link. */
function markdownProseTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent === null) continue
    if (parent.closest('code, pre, a, button') !== null) continue
    // Mention chips from an earlier pass stay untouched, or each effect rerun
    // would wrap another chip around the last one.
    if (css.mention !== undefined && parent.closest(`[class~="${css.mention}"]`) !== null) continue
    nodes.push(node as Text)
  }
  return nodes
}

/** Code spans whose entire content is one branded ref: model styling around a ref, not code. */
function markdownStyledRefCodeElements(root: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = []
  for (const code of root.querySelectorAll<HTMLElement>('code')) {
    if (code.closest('pre, a, button') !== null) continue
    if (!isSingleBrandedRef(code.textContent ?? '')) continue
    elements.push(code)
  }
  return elements
}

/** One resolved Task-ref chip built outside React, matching the styled ref link. */
function resolvedTaskRefButton(taskRef: AgentTeamTaskRef, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  if (css.refLink !== undefined) button.className = css.refLink
  button.dataset.taskRef = taskRef
  button.title = taskRef
  button.textContent = label
  return button
}

/** One resolved Thread-ref chip built outside React, matching the styled ref link. */
function resolvedThreadRefButton(threadRef: AgentTeamThreadRef, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  if (css.refLink !== undefined) button.className = css.refLink
  button.dataset.threadRef = threadRef
  button.title = threadRef
  button.textContent = label
  return button
}

/** One roster-resolved Channel chip built outside React, matching the styled ref link. */
function resolvedChannelRefButton(channelRef: AgentTeamChannelRef, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  if (css.refLink !== undefined) button.className = css.refLink
  button.dataset.ref = channelRef
  button.title = channelRef
  button.textContent = label
  return button
}

/**
 * One roster-resolved Member chip built outside React. Openable Members jump
 * to their session through the delegated click listener; everyone else gets
 * a labelled but inert span, never a link-shaped misfire.
 *
 * ⚠ 索菲亚数据上 `sessionId` 恒 `undefined`（`WireMember` 没有会话 id，
 * 见 `./refs.ts` 的 `ResolvedMemberRef`）⇒ 永远走那个 `span` 支。
 * 分支保留，宿主接上成员会话后即可用。
 */
function resolvedMemberRefChip(memberRef: AgentTeamMemberId, label: string, sessionId?: SessionId): HTMLElement {
  if (sessionId === undefined) {
    const span = document.createElement('span')
    span.title = memberRef
    span.textContent = label
    return span
  }
  const button = document.createElement('button')
  button.type = 'button'
  if (css.refLink !== undefined) button.className = css.refLink
  button.dataset.memberSession = sessionId
  button.title = memberRef
  button.textContent = label
  return button
}

/** Replace a whole-ref code span with its resolved chip once known. */
function renderResolvedMarkdownCodeRef(code: HTMLElement, taskLabel: (taskNumber: number) => string, threadChipLabel: (title: string) => string, channelChipLabel: (name: string) => string, memberChipLabel: (name: string) => string, channelNameOf: ((ref: AgentTeamChannelRef) => string | undefined) | undefined, memberOf: ((ref: AgentTeamMemberId) => ResolvedMemberRef | undefined) | undefined): void {
  const segments = splitBrandedRefs((code.textContent ?? '').trim())
  const segment = segments.length === 1 ? segments[0]! : undefined
  const ref = segment?.ref
  if (ref === undefined) return
  // Task and Thread refs need Host resolution before becoming human-readable
  // links; Channel and Member refs resolve against the loaded rosters, and
  // anything the roster does not know stays untouched plain text.
  if (ref.startsWith('task:')) {
    const resolved = cachedResolvedTaskRef(ref as AgentTeamTaskRef)
    if (resolved === undefined) return
    code.replaceWith(resolvedTaskRefButton(ref as AgentTeamTaskRef, taskLabel(resolved.taskNumber)))
    return
  }
  if (ref.startsWith('thread:')) {
    const resolved = cachedResolvedThreadRef(ref as AgentTeamThreadRef)
    if (resolved === undefined) return
    code.replaceWith(resolvedThreadRefButton(ref as AgentTeamThreadRef, threadChipLabel(resolved.title)))
    return
  }
  if (ref.startsWith('channel:')) {
    const name = channelNameOf?.(ref as AgentTeamChannelRef)
    if (name === undefined) return
    code.replaceWith(resolvedChannelRefButton(ref as AgentTeamChannelRef, channelChipLabel(name)))
    return
  }
  if (ref.startsWith('member:')) {
    const resolved = memberOf?.(ref as AgentTeamMemberId)
    if (resolved === undefined) return
    code.replaceWith(resolvedMemberRefChip(ref as AgentTeamMemberId, memberChipLabel(resolved.handle), resolved.openable ? resolved.sessionId : undefined))
  }
}

/** Replace resolved Task/Thread/Channel/Member refs and structured mention handles in one prose text node without changing Markdown structure. */
function renderResolvedMarkdownText(node: Text, mentionNames: readonly MentionHandle[], taskLabel: (taskNumber: number) => string, threadChipLabel: (title: string) => string, channelChipLabel: (name: string) => string, memberChipLabel: (name: string) => string, channelNameOf: ((ref: AgentTeamChannelRef) => string | undefined) | undefined, memberOf: ((ref: AgentTeamMemberId) => ResolvedMemberRef | undefined) | undefined): void {
  let changed = false
  const fragment = document.createDocumentFragment()
  for (const refSegment of splitBrandedRefs(node.data)) {
    if (refSegment.ref === undefined) {
      for (const mentionSegment of splitMentionNames(refSegment.text, mentionNames).segments) {
        if (!mentionSegment.mention) {
          fragment.append(mentionSegment.text)
          continue
        }
        changed = true
        const chip = document.createElement('span')
        if (css.mention !== undefined) chip.className = css.mention
        chip.textContent = mentionSegment.text
        fragment.append(chip)
      }
      continue
    }
    // Task and Thread refs need Host resolution before becoming human-readable
    // links; Channel and Member refs resolve against the loaded rosters.
    // Unresolvable refs stay plain text so prose never misfires as a link.
    if (refSegment.ref.startsWith('task:')) {
      const resolved = cachedResolvedTaskRef(refSegment.ref as AgentTeamTaskRef)
      if (resolved === undefined) {
        fragment.append(refSegment.text)
        continue
      }
      changed = true
      fragment.append(resolvedTaskRefButton(refSegment.ref as AgentTeamTaskRef, taskLabel(resolved.taskNumber)))
    } else if (refSegment.ref.startsWith('thread:')) {
      const resolved = cachedResolvedThreadRef(refSegment.ref as AgentTeamThreadRef)
      if (resolved === undefined) {
        fragment.append(refSegment.text)
        continue
      }
      changed = true
      fragment.append(resolvedThreadRefButton(refSegment.ref as AgentTeamThreadRef, threadChipLabel(resolved.title)))
    } else if (refSegment.ref.startsWith('channel:')) {
      const name = channelNameOf?.(refSegment.ref as AgentTeamChannelRef)
      if (name === undefined) {
        fragment.append(refSegment.text)
        continue
      }
      changed = true
      fragment.append(resolvedChannelRefButton(refSegment.ref as AgentTeamChannelRef, channelChipLabel(name)))
    } else if (refSegment.ref.startsWith('member:')) {
      const resolved = memberOf?.(refSegment.ref as AgentTeamMemberId)
      if (resolved === undefined) {
        fragment.append(refSegment.text)
        continue
      }
      changed = true
      fragment.append(resolvedMemberRefChip(refSegment.ref as AgentTeamMemberId, memberChipLabel(resolved.handle), resolved.openable ? resolved.sessionId : undefined))
    } else {
      fragment.append(refSegment.text)
    }
  }
  if (changed) node.replaceWith(fragment)
}

/** Render one literal text run, linkifying branded refs when navigation is available. */
function renderRefs(text: string, onOpenRef: ((ref: string) => void) | undefined, onOpenMemberSession: ((sessionId: SessionId) => void) | undefined, taskLabel: (taskNumber: number) => string, threadChipLabel: (title: string) => string, channelChipLabel: (name: string) => string, memberChipLabel: (name: string) => string, channelNameOf: ((ref: AgentTeamChannelRef) => string | undefined) | undefined, memberOf: ((ref: AgentTeamMemberId) => ResolvedMemberRef | undefined) | undefined): ReactNode {
  if (onOpenRef === undefined) return text
  // ⚠ 索菲亚移植点：上游 `Fragment` 来自顶层 `import { Fragment } from 'react'`。
  // 这里从 `react()` 惰性取（本函数只在渲染期被调用）。`react()` 有缓存，
  // 取用本身零开销；**不能**用 `../../jsx-runtime.ts` 导出的那个 Fragment
  // 写带 `key` 的用法（它是 `symbol`，JSX 元素类型不可调用，
  // 见 `react-runtime.ts` 的 `ReactFace.Fragment` 说明）。
  const { Fragment } = react()
  return splitBrandedRefs(text).map((segment, index) => {
    if (segment.ref === undefined) return <Fragment key={index}>{segment.text}</Fragment>
    // Task and Thread refs link only once the Host confirms them; Channel and
    // Member refs link once the loaded roster knows them. Anything unknown
    // stays plain text so prose never misfires as a link.
    if (segment.ref.startsWith('task:')) {
      const resolved = cachedResolvedTaskRef(segment.ref as AgentTeamTaskRef)
      if (resolved === undefined) return <Fragment key={index}>{segment.text}</Fragment>
      return <button key={index} type="button" className={css.refLink} title={segment.ref} onClick={() => { onOpenRef(segment.ref!) }}>{taskLabel(resolved.taskNumber)}</button>
    }
    if (segment.ref.startsWith('thread:')) {
      const resolved = cachedResolvedThreadRef(segment.ref as AgentTeamThreadRef)
      if (resolved === undefined) return <Fragment key={index}>{segment.text}</Fragment>
      return <button key={index} type="button" className={css.refLink} title={segment.ref} onClick={() => { onOpenRef(segment.ref!) }}>{threadChipLabel(resolved.title)}</button>
    }
    if (segment.ref.startsWith('channel:')) {
      const name = channelNameOf?.(segment.ref as AgentTeamChannelRef)
      if (name === undefined) return <Fragment key={index}>{segment.text}</Fragment>
      return <button key={index} type="button" className={css.refLink} title={segment.ref} onClick={() => { onOpenRef(segment.ref!) }}>{channelChipLabel(name)}</button>
    }
    if (segment.ref.startsWith('member:')) {
      const resolved = memberOf?.(segment.ref as AgentTeamMemberId)
      if (resolved === undefined) return <Fragment key={index}>{segment.text}</Fragment>
      // Known but not openable (suspended Members, the Human): a labelled
      // span, informative without promising a jump that cannot happen.
      if (!resolved.openable || resolved.sessionId === undefined || onOpenMemberSession === undefined) {
        return <span key={index} title={segment.ref}>{memberChipLabel(resolved.handle)}</span>
      }
      const sessionId = resolved.sessionId
      return <button key={index} type="button" className={css.refLink} title={segment.ref} onClick={() => { onOpenMemberSession(sessionId) }}>{memberChipLabel(resolved.handle)}</button>
    }
    return <Fragment key={index}>{segment.text}</Fragment>
  })
}

/**
 * One message's attachment strip: image thumbnails with a large view, or name chips when bytes are gone.
 *
 * ⚠ 索菲亚数据上**永不渲染**（`attachments` 恒 `undefined`，见文件头「附件」段）。
 * 结构逐字照抄，宿主补上附件面后接线即可用。
 */
function TeamAttachmentStrip({ attachments, loadAttachment, t }: {
  readonly attachments: readonly AgentTeamMessageAttachment[]
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
}) {
  const { useState } = hooks()
  const [zoomed, setZoomed] = useState<AgentTeamMessageAttachment>()
  return <div className={css.attachmentStrip}>
    {attachments.map(attachment => <TeamAttachment
      key={attachment.attachmentId}
      attachment={attachment}
      {...(loadAttachment === undefined ? {} : { loadAttachment })}
      {...(t === undefined ? {} : { t })}
      onZoom={setZoomed}
    />)}
    {zoomed !== undefined && <primitives.Modal open {...(css.attachmentModal === undefined ? {} : { className: css.attachmentModal })} title={zoomed.name} closeLabel={t?.('close') ?? 'Close'} onClose={() => { setZoomed(undefined) }}>
      <img className={css.attachmentZoom} src={cachedAttachmentDataUrl(zoomed.attachmentId) ?? undefined} alt={zoomed.name} />
    </primitives.Modal>}
  </div>
}

function TeamAttachment({ attachment, loadAttachment, t, onZoom }: {
  readonly attachment: AgentTeamMessageAttachment
  readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly t?: TeamConversationProps['t'] | undefined
  readonly onZoom: (attachment: AgentTeamMessageAttachment) => void
}) {
  const { useEffect, useState } = hooks()
  const wantsPreview = loadAttachment !== undefined && attachment.mediaType.startsWith('image/')
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(wantsPreview ? cachedAttachmentDataUrl(attachment.attachmentId) : null)
  useEffect(() => {
    if (!wantsPreview || dataUrl !== undefined) return
    let mounted = true
    void loadAttachmentDataUrl(loadAttachment, attachment).then(url => { if (mounted) setDataUrl(url) })
    return () => { mounted = false }
  }, [wantsPreview, dataUrl, loadAttachment, attachment])
  const expired = t?.('attachmentExpired') ?? 'File no longer cached'
  if (wantsPreview && dataUrl !== null) {
    return <button type="button" className={css.attachmentThumb} aria-label={t?.('viewImage', { name: attachment.name }) ?? attachment.name} title={attachment.name} onClick={() => { onZoom(attachment) }}>
      <img src={dataUrl} alt={attachment.name} />
    </button>
  }
  return <span className={css.attachmentChip} title={wantsPreview ? expired : `${attachment.name} · ${formatByteSize(attachment.byteSize)}`}>
    <span className={css.attachmentChipName}>{attachment.name}</span>
    <span className={css.attachmentChipSize}>{wantsPreview ? expired : formatByteSize(attachment.byteSize)}</span>
  </span>
}
