/** Package-owned invariant companion for `@wowyuarm/dsh-agent-team`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@wowyuarm/dsh-agent-team'

/** Cordis companion plugin name. */
export const name = 'agent-team-invariant'
/** Services required before the companion can validate Team state. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign(
  async (ctx: Context, fail: (message: string) => never) => {
    const divergence = (error: unknown): string =>
      `durable ledger and Team projection diverged: ${String(error)}`

    // Mounting stays synchronous: a durable ledger that cannot be re-derived
    // must fail startup instead of racing the first commit. The mount adopts
    // the record-level replay the constructor already ran, once and only while
    // nothing has committed since; every later validation, and every
    // commit-driven one below, replays the whole durable table.
    try {
      ctx.agentTeam.validateLedgerAtMount()
    } catch (error) {
      fail(divergence(error))
    }

    // The commit path cannot pay a full replay before its Remote response
    // returns, and opening a Thread commits. The replay stays the same full one
    // over the durable table, but commits coalesce into a single run in the
    // check phase, after the I/O turn carrying the response. A divergence stays
    // loud: it is logged where it is detected, and every later commit re-raises
    // it on a caller-owned frame until a replay comes back clean.
    let latched: string | undefined
    let pending: NodeJS.Immediate | undefined
    const check = (): void => {
      pending = undefined
      try {
        ctx.agentTeam.validateLedger()
        latched = undefined
      } catch (error) {
        latched = divergence(error)
        ctx.logger.error(`agent-team: ${latched}`)
      }
    }
    ctx.effect(() => () => {
      if (pending !== undefined) clearImmediate(pending)
      pending = undefined
    }, 'agent-team.invariant.pending-validation')
    ctx.on('agent-team/committed', () => {
      // Scheduled before the latch re-raises: a replay that comes back clean is
      // what releases it.
      if (pending === undefined) pending = setImmediate(check)
      if (latched !== undefined) fail(latched)
    })
  },
  { inject: ['agentTeam'] },
)

/**
 * Register the Agent Team ledger invariant.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
