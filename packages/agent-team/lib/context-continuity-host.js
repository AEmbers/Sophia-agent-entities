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
 * @module dsh-sophia-entities/context-continuity-host
 */
import { createHash } from 'node:crypto';
import { ContextContinuityCoordinator, ContextMessageCodec, } from '@wowyuarm/dsh-context-continuity';
import { SessionId as SessionIdBrand } from '@deepseek-ai/dsh-session';
import { AGENT_TEAM_PLUGIN_ID, isAgentTeamSource } from "./context-source.js";
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
});
/**
 * Team's `ContextContinuityHost`. Every method is a straight delegation except
 * the three that decide domain meaning: the durable rollover identity, which
 * queued messages are rederived Team notices, and the projection bridge.
 */
export class TeamContextContinuityHost {
    options;
    constructor(options) {
        this.options = options;
    }
    agentForSubject(memberId) {
        return this.options.agentForMember(memberId);
    }
    subjectForAgent(agent) {
        const member = this.options.memberForAgent(agent);
        if (member === undefined)
            return undefined;
        return { id: member.memberId, sessionId: member.sessionId };
    }
    projectionForSubject(memberId, sessionId) {
        return this.options.projectionForMember(memberId, sessionId);
    }
    executeTransition(memberId, plan) {
        return this.options.executeTransition(memberId, plan);
    }
    /**
     * Rollover identity, unchanged from the in-repo coordinator: stable key over
     * the previous Session and the successful tool call, JSON-encoded so no
     * delimiter can alias across the two unconstrained fields, then hashed to a
     * fixed-length digest. Both names are durable — in-flight recovery converges
     * on `agent-team-rollover-<digest>`, and the ledger records the request id.
     */
    rolloverIdentity(previousSessionId, toolCallId) {
        const stableKey = createHash('sha256').update(JSON.stringify([previousSessionId, toolCallId])).digest('hex');
        return {
            newSessionId: SessionIdBrand(`agent-team-rollover-${stableKey}`),
            requestId: `agent-team:rollover:${stableKey}`,
        };
    }
    /**
     * A queued message the successor generation rederives from ledger facts: any
     * Team-attributed message. The engine excludes the handoff and continuation
     * envelopes before consulting this, so the two are ordinary delivered
     * context the next generation keeps.
     */
    isEphemeralNotice(message) {
        return isAgentTeamSource(message.source);
    }
    log(message) {
        this.options.log(message);
    }
}
/** Build the engine coordinator over Team's Member lifecycle. */
export function createTeamContextManagement(options) {
    return new ContextContinuityCoordinator(new TeamContextContinuityHost(options), TEAM_CONTEXT_CODEC);
}
