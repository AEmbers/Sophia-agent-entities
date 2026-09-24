/** The change scopes whose wakes one surface answers with a shared refresh round. */
export type SupplementalScope = 'workspace' | 'presence'

/** One change wake, carrying a version from the scope that issued it. */
export interface ScopeWake {
  readonly scope: SupplementalScope
  readonly version: number
}

/**
 * Per-scope coverage of the change versions one surface has already answered.
 *
 * A version is only comparable inside the scope that issued it: the Host
 * answers a workspace scope from the durable ledger position and a presence
 * scope from its process-local wake epoch, which starts low and climbs on every
 * Agent transition. One high-water mark shared by both would therefore let a
 * presence epoch swallow a later, smaller ledger sequence and park the surface
 * on stale data, so coverage and pending versions are kept per scope.
 *
 * One round answers one version per scope. The Host delivers one event to every
 * matching scope, so the first version a round sees in a scope it has not
 * answered yet is that event reaching a second scope, and joins the round
 * already fetching instead of earning a second identical read. A newer version
 * in a scope the round has answered arrived after the round issued its fetch,
 * so it owes one trailing round.
 */
export class ScopeCoverage {
  private readonly covered = new Map<SupplementalScope, number>()
  private readonly pending = new Map<SupplementalScope, number>()
  /** The scopes the open round has an answer for. */
  private readonly answered = new Set<SupplementalScope>()
  private fetching = false

  /** Folds one wake in and answers whether it opens a round. */
  wake(scope: SupplementalScope, version: number): boolean {
    if (version <= this.coveredOf(scope)) return false
    if (this.fetching && this.answered.has(scope)) {
      this.pending.set(scope, Math.max(this.pending.get(scope) ?? 0, version))
      return false
    }
    this.answered.add(scope)
    this.covered.set(scope, version)
    return !this.fetching
  }

  /** Opens a round's fetch window; versions observed from here on are pending. */
  beginRound(): void {
    this.pending.clear()
    this.fetching = true
  }

  /** Closes a round's fetch window and answers whether a trailing round is owed. */
  finishRound(): boolean {
    this.fetching = false
    this.answered.clear()
    let owed = false
    for (const [scope, version] of this.pending) {
      if (version <= this.coveredOf(scope)) continue
      this.covered.set(scope, version)
      owed = true
    }
    return owed
  }

  /** Drops every observation: a new owner starts with nothing covered. */
  reset(): void {
    this.covered.clear()
    this.pending.clear()
    this.answered.clear()
    this.fetching = false
  }

  private coveredOf(scope: SupplementalScope): number {
    return this.covered.get(scope) ?? 0
  }
}
