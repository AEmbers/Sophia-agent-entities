/**
 * 上游 `team-formatters.ts` + `attachment-preview.ts` 的索菲亚版。
 *
 * ## 为什么这两个文件合成一个
 *
 * 上游把「纯格式化」放在 `team-formatters.ts`，把「附件字节 → 可显示 URL」
 * 放在 `attachment-preview.ts`。索菲亚**没有附件能力**（`WireMessage` 只有
 * `body` 文本，宿主没有 `putAttachment` / `getAttachment` 路由）⇒
 * 附件那一路整条剥掉。剥掉之后 `attachment-preview.ts` 只剩下
 * `formatByteSize` 一个还在用的纯函数（composer 的文件 chip 会显示字节数）,
 * 为它单开一个文件没有意义，故并入本文件。
 *
 * ## 逐条与上游的差异（**只允许两类：类型来源 / 索菲亚没有的事实**）
 *
 * | 上游符号 | 索菲亚处置 |
 * |---|---|
 * | `formatTaskStatus` / `taskStatusDot` | 状态是**裸字符串**（不发明闭集）⇒ 查表 + 未知兜底 |
 * | `formatClaimState` / claim 相关 | **索菲亚没有 claim 模型** ⇒ 只保留签名与「无认领」文案 |
 * | `formatActivity` | 索菲亚的活动是**自由文本 summary**，没有结构化 kind ⇒ 留 text 兜底分支 |
 * | `stripAttachmentLines` | 剥掉（没有 `[attachment]` 提示行这一概念） |
 * | `formatByteSize` | 从 `attachment-preview.ts` 迁入（composer 仍在用） |
 * | 其余（ref / mention / 时间 / 折叠） | **逻辑逐字保留**，只改类型来源 |
 *
 * @module @sophia/core/client/vendor/team/team-formatters
 */

import type { AgentTeamActivity, AgentTeamClaim, AgentTeamClientMemberStatus, AgentTeamMemberId, AgentTeamTask } from './agent-team-types.ts'
// ⚠ 索菲亚移植点：上游 `formatRiskClass` 的返回类型把两个键声明成 `TeamKey`
// （`zh` 字典键的联合）。索菲亚的 `zh` **没有**那 6 组 `riskClass*` / `risk*` 键
// （risk 区在索菲亚不可达：`adapters.ts` 的 `presenceOf` 永不返回 `'error'`），
// 而 `t` 的签名收 `string` ⇒ 这里**不 import `TeamKey`**，用 `string`。
// 这样「缺这 12 个文案」不会被类型系统掩盖成「有」。宿主接上成员诊断后，
// 补 `locales.ts` 的键即可，本文件一行不用改。

/**
 * 上游那套「翻译函数」的形状。
 *
 * 上游从 `./slots.ts` 的 `TeamConversationProps['t']` 取；索菲亚的对应物是
 * `../bridge.ts` 的 `AgentTeamsTranslate`（同一份中文字典 + 插值）。
 * 这里**只做类型转出**，不再单独声明一份 —— 一份形状只能有一个定义。
 */
export type { AgentTeamsTranslate as TeamTranslate } from '../locales.ts'

/** 本模块内部用的最窄翻译函数形状（只要「键 + 可选参数 → 串」）。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * 任务状态 → 文案。
 *
 * ⚠ 索菲亚的任务状态是**裸 `string`**（`WireTaskStatus`，DAG 状态机属
 * `sophia-engine-dag`，本包不发明闭集 —— 见 `wire.ts` 的说明）。
 * ⇒ **不能**像上游那样用 `as const` 查表（那假定状态必在表内）。
 * 认不出的状态显示状态原文而不是抛错或显示空白：界面上看到 `blocked`
 * 比看到一个空洞有用，而且它**没有撒谎**（那就是宿主给的值）。
 */
export function formatTaskStatus(status: AgentTeamTask['status'], t: Translate): string {
  if (status === 'todo') return t('taskStatusTodo')
  if (status === 'in_progress') return t('taskStatusInProgress')
  if (status === 'in_review') return t('taskStatusInReview')
  if (status === 'done') return t('taskStatusDone')
  if (status === 'closed') return t('taskStatusClosed')
  // 兜底：原样显示宿主给的状态串（不猜测、不折叠成「未知」而抹掉信息）。
  return status
}

/** 上游的 `claimState*` 文案仍在（字典里有），但索菲亚不产出 claim ⇒ 只在被显式传入时用。 */
export function formatClaimState(state: AgentTeamClaim['state'], t: Translate): string {
  if (state === 'active') return t('claimStateActive')
  if (state === 'done') return t('claimStateDone')
  if (state === 'released') return t('claimStateReleased')
  return state
}

/**
 * 任务状态 → 状态点取值。与 `formatTaskStatus` 同一套兜底口径：
 * 认不出的状态给 `'quiet'`（中性灰点）而不是 `undefined` ——
 * 每个任务都该有一个点，缺一个点会被读成「界面坏了」。
 */
export function taskStatusDot(status: AgentTeamTask['status']): 'todo' | 'ongoing' | 'warning' | 'done' | 'quiet' {
  if (status === 'todo') return 'todo'
  if (status === 'in_progress') return 'ongoing'
  if (status === 'in_review') return 'warning'
  if (status === 'done') return 'done'
  return 'quiet'
}

/** One-line title snippet derived from the Task's root Message body. **逐字照抄上游。** */
export function formatTaskTitle(body: string): string {
  const firstLine = body.split('\n', 1)[0]?.trim() ?? ''
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine
}

/** Deterministic avatar hue for one Member identity; stable across sessions and themes. **逐字照抄上游。** */
export function memberHue(memberId: string): number {
  let hash = 0
  for (let index = 0; index < memberId.length; index += 1) hash = (hash * 31 + memberId.charCodeAt(index)) % 360
  return hash
}

/** One branded-ref occurrence inside a literal body segment. */
export interface RefSegment {
  readonly text: string
  /** The full `task:`/`channel:`/`thread:` ref when this segment is a link. */
  readonly ref?: string
}

// Full UUIDs and abbreviated forms (prefix plus the first 6+ hex chars, with
// or without the original hyphens) both match; resolution decides whether an
// abbreviation is real, so unresolvable matches stay plain text.
const BRANDED_REF_PATTERN = /\b(task|channel|thread):{1,2}[0-9a-f]{6,}(?:-[0-9a-f]{1,})*\b/gi

function canonicalBrandedRef(match: string): string {
  return match.replace('::', ':').toLowerCase()
}

/**
 * Split a literal text run into plain and branded-ref segments. **逐字照抄上游。**
 *
 * ⚠ 索菲亚的 ref 形态与上游**不同**：索菲亚的 id 是 `member:<8 位>` / `task-…`
 * 这类（见 `src/naming.ts` 的 `toMemberId`），**不是 UUID**。上游这条正则要求
 * 前缀后跟 6+ 位十六进制，故它对索菲亚的 `task-xxxx` 形态**多半不匹配**。
 *
 * 保留它而不是改成正则：改成正则就是**改上游业务逻辑**（超出「只改 import 与
 * 头像/命名」的授权范围），而且索菲亚的 `CAN_OPEN_REFS === false`
 * ⇒ 这些 ref **本来就不会被渲染成链接**，正则匹配与否不影响界面行为。
 * 如实记录为已知差异。
 */
export function splitBrandedRefs(text: string): readonly RefSegment[] {
  const segments: RefSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(BRANDED_REF_PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) segments.push({ text: text.slice(cursor, start) })
    segments.push({ text: match[0], ref: canonicalBrandedRef(match[0]) })
    cursor = start + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

/** Whether one string's whole content is exactly one branded ref. **逐字照抄上游。** */
export function isSingleBrandedRef(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  const matches = [...trimmed.matchAll(BRANDED_REF_PATTERN)]
  return matches.length === 1 && matches[0]![0] === trimmed
}

export interface MentionSegment {
  readonly text: string
  readonly mention: boolean
  /** Canonical handle of the mentioned Member; present only on mention segments. */
  readonly name?: string
}

/** The Human's handle before they could rename themselves; the Host keeps it as an alias. **逐字照抄上游。** */
export const HUMAN_HISTORIC_HANDLE = 'human'

/**
 * One mentioned Member as a Message renders them: the display name the seat
 * prints, plus every older handle that still addresses the same person. A
 * rename must not orphan the mentions written before it — the bodies say
 * `@human`, the roster says the new name, and both are the Human.
 *
 * ⚠ 索菲亚移植点：上游的「一个 handle 有多个历史拼写」在索菲亚**没有对应事实**
 * （`WireMember` 的 handle 不带改名历史，见 `../../wire.ts`）⇒ 索菲亚的产出方
 * （`mentionNamesOf`）只走 `string` 支。对象支**保留**：`splitMentionNames` /
 * `planMessageBody` 的上游签名要求它，删掉会让那两个函数的形状与上游分叉。
 */
export type MentionHandle = string | { readonly name: string; readonly also: readonly string[] }

/** Normalize one mention entry into its printed name and every handle that matches it. **逐字照抄上游。** */
function mentionHandlesOf(mention: MentionHandle): { name: string; handles: readonly string[] } {
  return typeof mention === 'string' ? { name: mention, handles: [mention] } : { name: mention.name, handles: [mention.name, ...mention.also] }
}

/** The printed name of one mention entry; its aliases follow that name, never the body. **逐字照抄上游。** */
export function mentionNameOf(mention: MentionHandle): string {
  return typeof mention === 'string' ? mention : mention.name
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Locate one Message's structured mention names inside its literal body.
 *
 * ⚠ 索菲亚移植点（**只放宽入参类型，不放宽匹配**）：上游收 `readonly MentionHandle[]`
 * 并用宿主共享的 `scanBodyHandles`（`@wowyuarm/dsh-agent-team/mentions`）扫描；
 * 索菲亚**没有那个包**（它是上游插件的一部分，不在 `tsdown.config.ts` 的
 * `PLATFORM_MODULES` 里）⇒ 保留本仓既有的本地正则扫描 —— 它的边界规则与上游同源
 * （Unicode 词边界、长 handle 优先、`@` 可省、代码内不识别）。
 * 入参从 `string[]` 放宽到 `MentionHandle[]`，是为了让上游调用点
 * （`planMessageBody` 传 `MentionHandle[]`）与本仓既有调用点（传 `string[]`，
 * 是它的子类型）**同时成立**，而不是二选一。
 */
export function splitMentionNames(text: string, mentions: readonly MentionHandle[]): { segments: MentionSegment[]; unmatched: readonly string[] } {
  if (mentions.length === 0) return { segments: [{ text, mention: false }], unmatched: [] }
  const entries = mentions.map(mentionHandlesOf)
  // Longest handle first: a shorter spelling must not eat a longer one.
  const ordered = entries.flatMap(entry => entry.handles).sort((left, right) => right.length - left.length)
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_@])@?(?:${ordered.map(name => `(${escapeRegExp(name)})`).join('|')})(?=$|[^\\p{L}\\p{N}_])`,
    'giu',
  )
  const segments: MentionSegment[] = []
  const matched = new Set<string>()
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const groupIndex = match.findIndex((group, index) => index >= 1 && group !== undefined)
    if (groupIndex < 1) continue
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), mention: false })
    const handle = ordered[groupIndex - 1]!
    // The scan hands back the entry's own spelling; only an entry matched
    // through another handle prints the name it answers to today.
    const owner = entries.find(entry => entry.handles.some(candidate => candidate.toLowerCase() === handle.toLowerCase()))
    const printed = owner === undefined || owner.name.toLowerCase() === handle.toLowerCase() ? handle : owner.name
    segments.push({ text: `@${printed}`, mention: true, name: printed })
    if (owner !== undefined) matched.add(owner.name.toLowerCase())
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mention: false })
  return { segments, unmatched: entries.map(entry => entry.name).filter(name => !matched.has(name.toLowerCase())) }
}

/** Whether one draft spells a handle as an authored `@mention`. **逐字照抄上游。** */
export function containsMention(body: string, handle: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])@${escapeRegExp(handle)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(body)
}

/** Whether one draft carries the `@all` marker the mention menu expands. **逐字照抄上游。** */
export function containsAllMention(body: string): boolean {
  return /(?<![\p{L}\p{N}_@])@all(?=$|[^\p{L}\p{N}_])/u.test(body)
}

/**
 * Every Member the mention menu's `@all` row stands for.
 *
 * ⚠ 上游这里过滤 `presence !== 'unavailable' && member.state !== 'inactive' && !== 'archived'`。
 * 索菲亚的 `state` 由 `adapters.ts` 从 `lifecycle` 派生，墓碑成员已被
 * `rosterOf` 过滤掉 ⇒ 本函数保留**全部**上游条件（它们仍然成立），
 * 语义没有放宽，只是有一部分条件在索菲亚的数据下恒真。
 */
export function allMentionMembers(members: readonly AgentTeamClientMemberStatus[]): readonly AgentTeamClientMemberStatus[] {
  return members.filter(status => status.presence !== 'unavailable' && status.member.state !== 'inactive' && status.member.state !== 'archived')
}

/** Member ids one draft asks to notify by text alone. **逻辑逐字照抄上游。** */
export function mentionedMemberIds(body: string, members: readonly AgentTeamClientMemberStatus[]): readonly AgentTeamMemberId[] {
  if (containsAllMention(body)) return allMentionMembers(members).map(status => status.member.memberId)
  return members
    .filter(status => status.member.state !== 'inactive' && status.member.state !== 'archived')
    .filter(status => containsMention(body, status.member.handle))
    .map(status => status.member.memberId)
}

/**
 * Canonical chip handles for one Message's structured mention refs.
 *
 * ⚠ 索菲亚移植点：上游第三参 `humanName` 必填（它把人类映射成一个稳定 handle）。
 * 索菲亚**没有人类成员这一维**（主人不是成员，见 AGENTS.md 的「唯一主人」模型）
 * ⇒ 该参声明为**可选**：既有的索菲亚调用点（两参）保持原样，上游形状的调用点
 * 传进来也成立。`member:human` 那条分支在索菲亚数据上不可达（`adapters.ts`
 * 的 mention 恒空），保留它是为了让这段与上游逐字对应。
 */
export function mentionNamesOf(mentions: readonly AgentTeamMemberId[], handles: ReadonlyMap<AgentTeamMemberId, string>, humanName?: string): MentionHandle[] {
  return mentions
    .map((memberId): MentionHandle | undefined => memberId === 'member:human'
      ? humanName === undefined
        ? HUMAN_HISTORIC_HANDLE
        : (humanName.toLowerCase() === HUMAN_HISTORIC_HANDLE ? humanName : { name: humanName, also: [HUMAN_HISTORIC_HANDLE] })
      : handles.get(memberId))
    .filter((name): name is MentionHandle => name !== undefined)
}

const MARKDOWN_BLOCK_CONSTRUCT = /(^|\n)[ \t]{0,3}(?:#{1,6}[ \t]|>[ \t]|[-*+][ \t]|\d+[.)][ \t])|^[ \t]*\|.+\|/m
const MARKDOWN_INLINE_CONSTRUCT = /[`*_[\]!]|~~~|```/

/** Whether an Agent body survives literal rendering unchanged. **逐字照抄上游。** */
export function isPlainTextBody(text: string): boolean {
  return !(MARKDOWN_BLOCK_CONSTRUCT.test(text) || MARKDOWN_INLINE_CONSTRUCT.test(text))
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Absolute local `YYYY-MM-DD HH:mm` label. **逐字照抄上游。** */
export function formatAbsoluteTime(occurredAt: string): string {
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Wall-clock label for one Message instant. **逐字照抄上游。** */
export function formatMessageTime(occurredAt: string, now = new Date()): string {
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return ''
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  if (sameDay) return `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const absolute = formatAbsoluteTime(occurredAt)
  return at.getFullYear() === now.getFullYear() ? absolute.slice(5) : absolute
}

function calendarDayDelta(at: Date, now: Date): number {
  const midnight = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((midnight(now) - midnight(at)) / 86_400_000)
}

/** Recency label for one Inbox row's newest fact. **逐字照抄上游。** */
export function formatInboxTime(occurredAt: string, t: Translate, now = new Date()): string {
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return ''
  const days = calendarDayDelta(at, now)
  if (days === 0) return `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (days === 1) return `${t('inboxTimeYesterday')} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  return formatMessageTime(occurredAt, now)
}

/**
 * 一条活动 → 文案。
 *
 * ⚠ **与上游的实质差异**：上游按 `activity.kind` 分支，从
 * `completedClaimRefs` / `claimRef` / `claimRefs` 这些**结构化字段**造句子。
 * 索菲亚的 `WireActivity` 只有 `actorMemberId` + 自由文本 `summary` +
 * `occurredAt`，**没有 kind、没有 claimRef**（见 `adapters.ts` 的 `activitiesOf`：
 * 索菲亚的活动一律标成非结构化的 `'summary'`）。
 *
 * ⇒ 这里保留上游全部结构化分支（将来接上结构化活动时它们就是对的），
 * 但**先**处理 `summary`：直接返回宿主给的文本。
 * 上游最后那行 `throw new Error('unknown Team Activity kind')` **被删掉** ——
 * 它对索菲亚是**必然可达**的路径（任何认不出的 kind），而界面不该因为
 * 宿主给了一个新 kind 就整页崩掉。改为返回 `summary` 兜底。
 */
export function formatActivity(activity: AgentTeamActivity, options: {
  readonly t: Translate
  readonly actorName: (memberId: AgentTeamMemberId) => string
  readonly claims: readonly AgentTeamClaim[]
  /** 索菲亚的兜底文本：非结构化活动的 `WireActivity.summary`。 */
  readonly summary?: string | undefined
}): string {
  const actor = options.actorName(activity.actor)
  if (activity.kind === 'accept') return options.t('activityAccepted', { actor })
  if (activity.kind === 'promote') return options.t('activityPromoted', { actor })
  if (activity.kind === 'close') return options.t('activityClosed', { actor })
  if (activity.kind === 'reopen') return options.t('activityReopened', { actor })
  if (activity.kind === 'claim' || activity.kind === 'done' || activity.kind === 'release') return options.t('claims', { actor })
  if (activity.kind === 'claims_released') return options.t('activityClaimsReleased', { actor, count: 0 })
  // 索菲亚的路径：宿主已经把话写好了（`WireActivity.summary`），原样显示。
  return options.summary ?? options.t('claims', { actor })
}

/**
 * 消息正文的折叠阈值。**逐字照抄上游。**
 *
 * 上游算的是「剥掉 `[attachment] <path>` 提示行之后的显示正文长度」。
 * 索菲亚没有那种提示行 ⇒ `stripAttachmentLines` 整条剥掉，
 * 直接量正文（见本文件头的差异表）。
 */
export const MESSAGE_COLLAPSE_CHARS = 600

/** Whether one displayed Message body starts clamped behind the expand control. **逐字照抄上游。** */
export function shouldClampMessage(displayBody: string): boolean {
  return displayBody.length > MESSAGE_COLLAPSE_CHARS
}

/** How one Message body renders. */
export type MessageBodyRender = 'inline' | 'literal' | 'markdown'

/** Rendering decision for one Message body, resolved once from its stored form. */
export interface PlannedMessageBody {
  readonly displayBody: string
  readonly richAgentBody: boolean
  readonly render: MessageBodyRender
  readonly inline?: ReturnType<typeof splitMentionNames>
  readonly fallbackNames: readonly string[]
  readonly fallbackRefs: readonly string[]
  readonly taskRefs: readonly string[]
  /** Thread refs cited in the body (上游同款)：`TeamMessage` 拿它批量做宿主解析。 */
  readonly threadRefs: readonly string[]
}

/**
 * Decide how one Message body renders.
 *
 * 上游这一步先跑 `stripAttachmentLines(body)`（把机器面向的
 * `[attachment] <path>` 提示行剥掉再显示）。索菲亚的
 * `TeamMessage.tsx` 现在**移植了**那个函数（见本文件末尾），但显示侧仍用
 * `body`：索菲亚的 `WireMessage.body` 由宿主写入、不含 `[attachment]` 提示行
 * （附件面整条不存在），所以这一步在索菲亚是恒等变换。
 * 其余分支逻辑（human / 纯文本 / Markdown / 兜底 chip 行）逐字保留。
 */
export function planMessageBody(body: string, options: {
  readonly human: boolean
  readonly mentionNames?: readonly MentionHandle[]
  readonly canOpenRefs: boolean
}): PlannedMessageBody {
  const displayBody = stripAttachmentLines(body) === '' ? body : stripAttachmentLines(body)
  const richAgentBody = !options.human && !isPlainTextBody(displayBody)
  const inline = (options.human || isPlainTextBody(displayBody)) && options.mentionNames !== undefined && options.mentionNames.length > 0
    ? splitMentionNames(displayBody, options.mentionNames)
    : undefined
  const fallbackNames = inline !== undefined ? inline.unmatched
    : richAgentBody && options.canOpenRefs && options.mentionNames !== undefined
      ? splitMentionNames(displayBody, options.mentionNames).unmatched
      : (options.mentionNames ?? []).map(mentionNameOf)
  const refs = splitBrandedRefs(displayBody).flatMap(segment => segment.ref === undefined ? [] : [segment.ref])
  const render: MessageBodyRender = inline !== undefined ? 'inline'
    : options.human || (options.canOpenRefs && !richAgentBody && refs.length > 0) ? 'literal'
    : 'markdown'
  return {
    displayBody,
    richAgentBody,
    render,
    ...(inline === undefined ? {} : { inline }),
    fallbackNames,
    fallbackRefs: richAgentBody && !options.canOpenRefs ? refs : [],
    taskRefs: options.canOpenRefs && !richAgentBody
      ? refs.filter(ref => ref.startsWith('task:'))
      : [],
    threadRefs: options.canOpenRefs && !richAgentBody
      ? refs.filter(ref => ref.startsWith('thread:'))
      : [],
  }
}

/**
 * Human-readable byte size for attachment chips.
 *
 * ⚠ **真相在 `./attachment-preview.ts`** —— 上游把它放在那里，本次移植完成后
 * 本文件改为**从那一处转出**。索菲亚初版把它并进了本文件（当时
 * `attachment-preview.ts` 还没移植），两份实现会让「1 KB」与「1.0 KB」
 * 在两张卡上分叉 —— 那正是「一个概念一个真相」要堵的。
 *
 * ⚠ 行为差异（**如实记录：这是一次回退**）：索菲亚初版多一条
 * `!Number.isFinite(bytes) || bytes < 0 ⇒ ''` 的兜底，上游没有。
 * 主人的口径是「样式照抄，不要自己发挥」⇒ 以上游为准，舍掉那条兜底。
 * 唯一调用点是 `TeamComposer` 的文件 chip，输入为 `File.size`（非负有限）。
 */
export { formatByteSize } from './attachment-preview.ts'

// ────────────────────────────────────────────────────────────────────────────
// 以下四个函数是**本次补齐**的上游成员（先前索菲亚版没抄）。
// `TeamThreadPage.tsx` / `TeamMessage.tsx` 直接依赖它们；
// 其中 `formatRiskClass` 在索菲亚数据上不可达（见它的注释）。
// ────────────────────────────────────────────────────────────────────────────

/**
 * Runtime-risk class → its two localized keys.
 *
 * ⚠ 索菲亚移植点：上游写 `as const satisfies Record<AgentTeamMemberDiagnosticClass, …>`
 * —— 那是**闭集**约束。索菲亚的 `AgentTeamMemberDiagnosticClass = string`
 * （见 `agent-team-types.ts`：索菲亚不发明闭集）⇒ `satisfies Record<string, …>`
 * 无法满足，改为「闭集表 + 未知兜底到 `runtime`」的取值函数（见 `riskClassOf`）。
 */
const RISK_CLASS_KEYS = {
  'session-refused': ['riskClassSessionRefused', 'riskSessionRefused'],
  'session-unreadable': ['riskClassSessionUnreadable', 'riskSessionUnreadable'],
  'preset-composition': ['riskClassPresetComposition', 'riskPresetComposition'],
  'rollover': ['riskClassRollover', 'riskRollover'],
  'runtime': ['riskClassRuntime', 'riskRuntime'],
  'activation': ['riskClassActivation', 'riskActivation'],
} as const

type RiskClassKey = keyof typeof RISK_CLASS_KEYS

/**
 * 取值：认得的 class 用它自己的两个键，**认不得的回落到 `runtime`**。
 *
 * 为什么不抛错：诊断 class 来自宿主（`WireMember.presence` 那条线），
 * 新增一个 class 不该让整个 Thread 页打不开 —— 回落到「运行时风险」这一档
 * 仍然是一句可读的话（与上游「`?? 'runtime'`」同一条兜底口径）。
 */
function riskClassOf(classOf: string | undefined): readonly [string, string] {
  return RISK_CLASS_KEYS[(classOf ?? 'runtime') as RiskClassKey] ?? RISK_CLASS_KEYS.runtime
}

/**
 * The two localized halves of one runtime-risk statement: the class label names
 * what kind of problem this is, and the sentence key states it of the Member
 * (it keeps its `{member}` placeholder so the caller supplies the handle). The
 * Host's own diagnostic stays English and belongs in the row's title, so the
 * visible line reads in the interface language.
 *
 * ⚠ 索菲亚数据上**不可达**：唯一调用点（`TeamThreadPage` 的 `risks`）
 * 先过 `status.presence !== 'error'` 这一关，而索菲亚的 `adapters.ts`
 * `presenceOf` **永不返回 `'error'`** ⇒ `risks` 恒空。
 * 保留函数是为了让那段 risks 渲染（上游 790–796 行）的结构与这句话完整留在原处。
 */
export function formatRiskClass(
  status: Pick<AgentTeamClientMemberStatus, 'diagnostic'>,
  t: Translate,
): { readonly label: string, readonly sentenceKey: string } {
  const [labelKey, sentenceKey] = riskClassOf(status.diagnostic?.class)
  return { label: t(labelKey), sentenceKey }
}

/**
 * The first sentence of a Host diagnostic: risk rows read one line, and the
 * Host writes the reason as its first sentence with recovery context after it.
 * A terminator the Host used mid-sentence becomes a full stop so the clamped
 * line reads as a sentence; the untouched text stays in the row's title.
 */
export function firstSentence(detail: string): string {
  const trimmed = detail.trim()
  const end = trimmed.search(/[.。;；]/)
  if (end === -1) return trimmed
  // A terminator that already ends a sentence stays; a separator the Host used
  // mid-sentence becomes a full stop.
  return trimmed[end] === '.' || trimmed[end] === '。' ? trimmed.slice(0, end + 1) : `${trimmed.slice(0, end)}.`
}

/** Accessible label for one "who is on this work" stack: its owners' handles, comma-separated. */
export function claimersLabel(owners: ReadonlyArray<{ readonly name: string }>, t: Translate): string {
  return t('claimers', { names: owners.map(owner => `@${owner.name}`).join(', ') })
}

/** Remove the machine-facing `[attachment] <path>` prompt lines from a body before display. */
export function stripAttachmentLines(body: string): string {
  return body.replaceAll(/^\[attachment\] .*$(\n)?/gm, '').replace(/\n+$/, '')
}
