import type { ReactElement } from 'react'
import { primitives } from '../bridge.ts'
import type { AgentTeamClientMemberStatus } from './agent-team-types.ts'
import { TeamMemberAvatarImage } from './TeamMemberAvatarImage.tsx'

/**
 * One membership action: what it says and which Member it acts on. **逐字照抄上游。**
 */
export interface TeamMemberAction {
  readonly label: string
  readonly onSelect: () => void
  readonly disabled?: boolean
}

/**
 * The one place a Member's identity is drawn: the avatar plus the handle over its
 * description.
 *
 * ## 改动②A：头像换成索菲亚的
 *
 * 上游画的是 `--team-avatar-hue` 色相圆 + `handle` 首字（**它没有头像素材**）。
 * 索菲亚有真实素材（`assets/members/…`）⇒ 换成
 * `TeamMemberAvatarImage`（走索菲亚那套 `.sp-avatar` 类名与判据）。
 *
 * ## ⚠ 本文件**不在**本次两页（收件箱 / Thread）的依赖里 —— 为什么仍然移植
 *
 * 主人的范围是「两页 + 它们同目录的支撑文件」。`TeamMemberRow` 的消费者是
 * 侧栏与成员对话框（`TeamAgentsPanel` / `TeamMemberEditor`），**不在**本次范围。
 * 移植它的理由：它 import 的 `TeamMemberAvatar`（上游版）**已被索菲亚替换掉**
 * （本次的改动②A 把它换成了 `TeamMemberAvatarImage`），
 * 于是上游那条「同一个成员的身份在 roster / sidebar / composer 三处必须同形」的
 * 单一来源链在本目录**断了** —— 侧栏那批文件将来移植时，必须有一个现成的
 * 索菲亚版身份组件可接，否则它们会各自再画一次头像（正是上游这条注释要避免的事）。
 *
 * ⇒ 移植它**只为续上那条链**，它自己当前无人渲染。这是**有意的、可核对的**：
 * `grep -rn "TeamMemberRow" src/client/vendor/team/ | grep -v "TeamMemberRow.tsx"`
 * 在本次交付里只会命中 `index.ts` 的转出。
 *
 * ## ⚠ 相对上游**去掉**的两个成员（都是「索菲亚没有」）
 *
 * - `presenceLabel` / `presenceDotState` / `TeamStateDot` 叠加的**头像角标**：
 *   索菲亚的 `WireMember.presence` 是 `'idle' | 'running' | undefined`，
 *   没有上游四态里的 `'error'`；而且索菲亚面板的成员卡（`components.tsx` 的
 *   `MemberCard`）已有自己的状态点位置与判据。这里**不**再叠一个角标，
 *   避免同一个成员在面板上出现两个状态点。
 * - `Tooltip`：上游用它包住头像显示 presence 文案。索菲亚的文案来源是
 *   `TeamPresenceDot`（它按 `AgentTeamClientMemberStatus` 取），本组件不重复那套。
 *   `title` 属性给出同一信息，少一层宿主原子依赖。
 */
export function TeamMemberIdentity({ status, name, className }: {
  readonly status: AgentTeamClientMemberStatus
  /** Handle spelling for this surface; defaults to the mention form. */
  readonly name?: string | undefined
  readonly className?: string | undefined
}): ReactElement {
  const handle = name ?? `@${status.member.handle.replace(/^@/, '')}`
  return <>
    <TeamMemberAvatarImage
      {...(status.member.avatarPath === undefined ? {} : { avatarPath: status.member.avatarPath })}
      name={handle}
      // 材质硬约束 2：成员名**必须**另有 DOM 文本（`data-sophia-name`）。
      // 那一份在这里（`<strong>{handle}</strong>`），故头像本身对读屏隐藏。
      label={handle}
    />
    <span className={className === undefined ? cssCopy : `${cssCopy} ${className}`}>
      <strong data-sophia-name={handle}>{handle}</strong>
      <small>{status.member.description}</small>
    </span>
  </>
}

/** 上游 `member-row.module.css` 的 `.copy` 类名在本目录不存在（那个 CSS 未移植）⇒ 用本地常量。 */
const cssCopy = 'sp-team-member-copy'

/**
 * The one roster row: identity, an optional membership action, and the row's own
 * failure line. **结构逐字照抄上游**（`data-team-member-row` 属性保留）。
 *
 * ⚠ 上游的 `t: TeamSidebarProps['t']` 参数已剥掉：本组件**不用**翻译函数
 * （文案全部来自 `status` 与 `action.label`，由调用方给）。见文件头的说明。
 */
export function TeamMemberRow({ status, action, error, className }: {
  readonly status: AgentTeamClientMemberStatus
  readonly action?: TeamMemberAction | undefined
  /** Transport failure for this row's last mutation, announced in place. */
  readonly error?: string | undefined
  readonly className?: string | undefined
}): ReactElement {
  return <div className={className === undefined ? 'sp-team-member-row' : `sp-team-member-row ${className}`} data-team-member-row>
    <TeamMemberIdentity status={status} />
    {action !== undefined && <primitives.Button size="sm" variant="outline" disabled={action.disabled === true} onClick={action.onSelect}>{action.label}</primitives.Button>}
    {error !== undefined && <p role="alert">{error}</p>}
  </div>
}

/** 上游 `TeamMemberRow` 的类名映射（`member-row.module.css` 未移植 ⇒ 显式记录缺口）。 */
export const MEMBER_ROW_CSS_OMITTED = 'member-row.module.css 未移植：本次两页不使用本组件'
