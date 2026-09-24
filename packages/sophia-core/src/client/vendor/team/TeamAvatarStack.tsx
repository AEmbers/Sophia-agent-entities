import type { CSSProperties, ReactElement } from 'react'
import type { AgentTeamMemberId } from './agent-team-types.ts'
import { TeamMemberAvatarImage } from './TeamMemberAvatarImage.tsx'
import { memberHue } from './team-formatters.ts'
import css from './avatar-stack.module.css'

/** Distinct owners past this count collapse into one `+N` chip. **逐字照抄上游。** */
const MAX_VISIBLE = 3

/**
 * One owner as the stack draws it.
 *
 * ⚠ 相对上游**加了一个字段** `avatarPath`（改动②A）：
 * 上游只有 `memberId`（色相）+ `name`（首字），因为上游没有头像素材。
 * 索菲亚有（`assets/members/…`）⇒ 加了这一个字段，**并且它是可选的**：
 * 调用方拿不到路径时（例如「最新事实的 actor」而团长里没有这个人）
 * 仍然退回首字圆 —— 正是上游那套行为。
 */
export interface TeamAvatarOwner {
  readonly memberId: AgentTeamMemberId
  /** Public handle, or the raw Member id when the roster no longer names them. */
  readonly name: string
  /** 索菲亚头像的仓库相对路径（`WireMember.avatarPath`）。见本接口说明。 */
  readonly avatarPath?: string | undefined
}

/**
 * The compact "who is on this work" stack: overlapping 18px Member circles in
 * the shared identity language, capped at three plus a `+N` chip. The circles
 * are presentational, so the stack is one `role="img"` whose label carries the
 * whole roster — three anonymous initials would read as noise.
 *
 * ## 改动②A：头像**真的**换成索菲亚的了
 *
 * 上游这里画 `memberHue` 色相圆 + 首字（`<span className={css.avatar}>首字</span>`）。
 * 索菲亚的硬约束是「成员头像换成我们的」、「只做 `border-radius:50%` +
 * `object-fit:cover`、不做二次裁切」（`scripts/check-t5-structure.mjs` 逐条判
 * `.sp-avatar` 规则体）。⇒ 每个有 `avatarPath` 的成员改渲染
 * `TeamMemberAvatarImage`（它用的就是索菲亚那套 `.sp-avatar` 类名与判据）。
 *
 * ⚠ **色相圆没有删，它成了降级路径**（这不是「上游残留」）：
 * 索菲亚的 `WireMember.avatarPath` 按 `wire.ts` 是**可选**的，而且宿主头像路由
 * 拿不到文件时会 404（`TeamMemberAvatarImage` 的 `failedUrl` 分支）。
 * 那条路径必须有东西可画 —— 上游那个色相圆正好就是它（同一份 CSS 几何：
 * 18px、重叠、`--team-avatar-hue` 色相），故保留。
 * `memberHue` 与 `--team-avatar-hue` 都是**上游原有**的机制，一行未改。
 */
export function TeamAvatarStack({ owners, label }: {
  readonly owners: readonly TeamAvatarOwner[]
  readonly label: string
}): ReactElement | null {
  if (owners.length === 0) return null
  const shown = owners.slice(0, MAX_VISIBLE)
  const overflow = owners.length - shown.length
  return <span className={css.stack} role="img" aria-label={label}>
    {shown.map(owner => (
      <span
        key={owner.memberId}
        className={css.avatar}
        style={{ '--team-avatar-hue': memberHue(owner.memberId) } as CSSProperties}
      >
        {/* ⚠ 尺寸传给索菲亚头像组件 → 它写成**内联** `width/height: 18px`，
            正好与本 stack 的圆同尺寸（`.sp-avatar` 的 CSS 默认是 32px）。
            内联尺寸不触碰被门禁判的那四个属性（object-position / padding /
            clip-path / transform），故「不做二次裁切」的硬约束仍然成立。
            与索菲亚 `components.tsx` 用 `size` 覆盖尺寸是同一手法。 */}
        <TeamMemberAvatarImage avatarPath={owner.avatarPath} name={owner.name} size={18} />
      </span>
    ))}
    {overflow > 0 && <span className={css.overflow}>{`+${overflow}`}</span>}
  </span>
}
