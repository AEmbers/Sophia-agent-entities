import type { CSSProperties } from 'react'
import type { AgentTeamMemberId } from '@wowyuarm/dsh-agent-team/types'
import { memberHue } from './team-formatters.ts'
import css from './avatar-stack.module.css'

/** Distinct owners past this count collapse into one `+N` chip. */
const MAX_VISIBLE = 3

/** One owner as the stack draws it: the id carries the hue, the name the initial. */
export interface TeamAvatarOwner {
  readonly memberId: AgentTeamMemberId
  /** Public handle, or the raw Member id when the roster no longer names them. */
  readonly name: string
}

/**
 * The compact "who is on this work" stack: overlapping 18px Member circles in
 * the shared identity language, capped at three plus a `+N` chip. The circles
 * are presentational, so the stack is one `role="img"` whose label carries the
 * whole roster — three anonymous initials would read as noise.
 */
export function TeamAvatarStack({ owners, label }: {
  readonly owners: readonly TeamAvatarOwner[]
  readonly label: string
}) {
  if (owners.length === 0) return null
  const shown = owners.slice(0, MAX_VISIBLE)
  const overflow = owners.length - shown.length
  return <span className={css.stack} role="img" aria-label={label}>
    {shown.map(owner => <span key={owner.memberId} className={css.avatar} style={{ '--team-avatar-hue': memberHue(owner.memberId) } as CSSProperties}>{initial(owner.name)}</span>)}
    {overflow > 0 && <span className={css.overflow}>{`+${overflow}`}</span>}
  </span>
}

/** First visible character of a handle — and of a raw Member id when that is all there is. */
function initial(name: string): string {
  return name.replace(/^@/, '').replace(/^member:/, '').slice(0, 1).toUpperCase()
}
