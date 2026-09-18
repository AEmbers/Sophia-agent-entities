import css from './countBadge.module.css'

/** Every count the Human reads is capped at this, so one wide number never widens the capsule. */
const COUNT_CAP = 99

/**
 * The one count capsule. The Human Inbox entry, the Channel feed's Thread
 * entry, and the Inbox queue row all answer the same question — how much is
 * waiting here — so they wear the same box rather than one hand-written copy
 * of the same declarations per surface. Three copies is how the feed's digit
 * ended up on a different line box from the other two.
 *
 * Zero is the absence of a count rather than a capsule reading zero, which is
 * the rule every caller wants and therefore the component's own.
 */
export function TeamCountBadge({ count, tone = 'solid', label, className }: {
  readonly count: number
  /** `hairline` is unread that merely arrived; the solid fill is unread that names this reader. */
  readonly tone?: 'solid' | 'hairline' | undefined
  /** The accessible name while the count is the only thing saying it; omit it when the surrounding control already carries the number. */
  readonly label?: string | undefined
  /** Placement belongs to the surface hanging the capsule: the narrow rail pins it to the icon's corner. */
  readonly className?: string | undefined
}) {
  if (count <= 0) return null
  const text = count > COUNT_CAP ? `${COUNT_CAP}+` : String(count)
  const classes = `${css.badge}${tone === 'hairline' ? ` ${css.hairline}` : ''}${className === undefined ? '' : ` ${className}`}`
  // Tests and the browser journey read the capsule by this attribute rather
  // than by a CSS-module hash, which changes whenever a rule is renamed.
  return label === undefined
    ? <span className={classes} data-team-count-badge={tone} aria-hidden="true">{text}</span>
    : <span className={classes} data-team-count-badge={tone} role="img" aria-label={label} title={label}>{text}</span>
}
