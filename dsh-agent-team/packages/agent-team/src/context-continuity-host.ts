/**
 * The Agent Team's binding of the context-continuity engine: how one Member
 * resolves to its live Agent and back, how a Member Session's fold state is
 * read, how a prepared generation swap runs in the Member lifecycle, and the
 * two domain dimensions the engine refuses to own (which queued messages are
 * Team notices, and how a rollover's durable identity is named).
 *
 * The engine owns every mechanic this module does not state: the idle-boundary
 * swap, carried input, checkpoint continuations, crash repair. Team owns the
 * Member vocabulary and the ledger-backed lifecycle behind
 * {@link TeamContextContinuityOptions.executeTransition}.
 *
 * The projection state this host hands the coordinator is the engine's own
 * (`ContextProjectionState`), read from the unit `context-projection.ts`
 * registers once per Host — one state shape, one fold, no translation.
 * @module @wowyuarm/dsh-agent-team/context-continuity-host
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import {
  ContextContinuityCoordinator,
  ContextMessageCodec,
  type ContextContinuityHost,
  type ContextProjectionState,
  type ContextSubject,
  type RolloverIdentity,
  type TransitionPlan,
} from '@wowyuarm/dsh-context-continuity'
import { SessionId as SessionIdBrand } from '@deepseek-ai/dsh-session'
import { AGENT_TEAM_PLUGIN_ID } from './context-source.ts'
import type { AgentTeamAgentMember, AgentTeamMemberId, AgentTeamRolloverSessionRequest } from './types.ts'

/**
 * The one writer of context-continuity messages for Team. Section names are
 * the engine's fixed vocabulary; only the plugin identity and the two
 * subject-facing prose lines are Team's, and both are frozen by history —
 * durable logs written by earlier generations are read back through this same
 * identity, so `handoffIntro` and `handoffVerifyNote` reproduce them byte for
 * byte.
 */
export const TEAM_CONTEXT_CODEC = new ContextMessageCodec({
  pluginId: AGENT_TEAM_PLUGIN_ID,
  handoffIntro: 'Context handoff: you are continuing as the same Team Member in a fresh private context.',
  handoffVerifyNote: 'Your handoff from the previous context follows. Verify external state before relying on it; a context change never rolls back files, processes, Team facts, or remote side effects.',
})

export interface TeamContextContinuityOptions {
  /** Resolve the live Agent of one Member; undefined leaves intent parked. */
  readonly agentForMember: (memberId: AgentTeamMemberId) => Agent | undefined
  /** Resolve the durable Member of one live Agent. */
  readonly memberForAgent: (agent: Agent) => AgentTeamAgentMember | undefined
  /**
   * Read one Member Session's engine-folded continuity state: the unit
   * registered by `context-projection.ts`, or undefined when the Member has no
   * live Session with that id (the coordinator leaves intent parked).
   */
  readonly projectionForMember: (memberId: AgentTeamMemberId, sessionId: SessionId) => ContextProjectionState | undefined
  /**
   * Execute one prepared Member generation swap at a true idle boundary:
   * commit, dispose, archive, create/activate, deliver the handoff first,
   * then carried input and the rederived Inbox. Returns once the Member runs
   * its new generation.
   */
  readonly executeTransition: (memberId: AgentTeamMemberId, plan: TransitionPlan) => Promise<void>
  /** Log one coordinator diagnostic. */
  readonly log: (message: string) => void
}

/**
 * Team's `ContextContinuityHost`. Every method is a straight delegation except
 * the three that decide domain meaning: the durable rollover identity, which
 * queued messages are rederived Team notices, and the projection bridge.
 */
export class TeamContextContinuityHost implements ContextContinuityHost<AgentTeamMemberId> {
  constructor(private readonly options: TeamContextContinuityOptions) {}

  agentForSubject(memberId: AgentTeamMemberId): Agent | undefined {
    return this.options.agentForMember(memberId)
  }

  subjectForAgent(agent: Agent): ContextSubject<AgentTeamMemberId> | undefined {
    const member = this.options.memberForAgent(agent)
    if (member === undefined) return undefined
    return { id: member.memberId, sessionId: member.sessionId }
  }

  projectionForSubject(memberId: AgentTeamMemberId, sessionId: SessionId): ContextProjectionState | undefined {
    return this.options.projectionForMember(memberId, sessionId)
  }

  executeTransition(memberId: AgentTeamMemberId, plan: TransitionPlan): Promise<void> {
    return this.options.executeTransition(memberId, plan)
  }

  /**
   * Rollover identity, unchanged from the in-repo coordinator: stable key over
   * the previous Session and the successful tool call, JSON-encoded so no
   * delimiter can alias across the two unconstrained fields, then hashed to a
   * fixed-length digest. Both names are durable — in-flight recovery converges
   * on `agent-team-rollover-<digest>`, and the ledger records the request id.
   */
  rolloverIdentity(previousSessionId: SessionId, toolCallId: string): RolloverIdentity {
    const stableKey = createHash('sha256').update(JSON.stringify([previousSessionId, toolCallId])).digest('hex')
    return {
      newSessionId: SessionIdBrand(`agent-team-rollover-${stableKey}`),
      requestId: `agent-team:rollover:${stableKey}` as AgentTeamRolloverSessionRequest['requestId'],
    }
  }

  /**
   * A queued message the successor generation rederives from ledger facts: any
   * Team-attributed message. The engine excludes the handoff and continuation
   * envelopes before consulting this, so the two are ordinary delivered
   * context the next generation keeps.
   */
  isEphemeralNotice(message: UserMessage): boolean {
    const source = message.source
    return source.kind === 'plugin' && source.plugin === AGENT_TEAM_PLUGIN_ID
  }

  log(message: string): void {
    this.options.log(message)
  }
}

/** Build the engine coordinator over Team's Member lifecycle. */
export function createTeamContextManagement(options: TeamContextContinuityOptions): ContextContinuityCoordinator<AgentTeamMemberId> {
  return new ContextContinuityCoordinator(new TeamContextContinuityHost(options), TEAM_CONTEXT_CODEC)
}
