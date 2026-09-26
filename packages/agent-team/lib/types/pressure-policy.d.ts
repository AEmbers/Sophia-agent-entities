/**
 * Team-owned context pressure policy.
 *
 * The Team preset mounts `compaction-basic` with `auto: false`; this
 * coordinator owns both policy entry points instead — the proactive handoff
 * notice near the effective handoff budget and the forced CompactionEngine
 * reduction before any request at or above the effective hard limit — while
 * reusing the public CompactionEngine implementation. The hard-limit
 * translation lives in exactly one method; no caller re-derives it.
 *
 * Fail-closed rule: at the hard limit, a compaction that no-ops, throws, is
 * cancelled, or does not advance the durable surface must block the model
 * request (reject the step) rather than knowingly submit over the Team limit.
 * A blocked Member keeps its log and reports a recoverable error.
 * @module dsh-sophia-entities/pressure-policy
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CompactionEngine } from '@deepseek-ai/dsh-compaction';
import type { AgentTeamMemberId } from './types.ts';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { type SessionEventFold } from './session-event-cursor.ts';
/**
 * Stable summary of the one-shot rollover pressure notice. It is a durable
 * marker: the notice's own presence in a Session's log is what latches the
 * policy, so the wording is read back and must not drift.
 */
export declare const CONTEXT_PRESSURE_NOTICE_SUMMARY = "Context pressure: prepare a handoff";
/**
 * Whether this Session's own span already carries the pressure notice: either
 * surfaced as a `user/message` or still queued in a durable
 * `agent/inbox/spliced` insert. Expressed as a fold rather than a scan because
 * the answer is monotone — once delivered it stays delivered for the
 * generation — so the cursor only ever has to read events it has not seen.
 */
export declare const PRESSURE_NOTICE_FOLD: SessionEventFold<boolean, SessionEvent>;
/** One pressure-notice text; concise, structured, and inside the reserve. */
export declare function contextPressureNoticeText(input: {
    readonly usageTokens: number;
    readonly handoffAt: number;
    readonly hardLimit: number;
    readonly activeClaims: readonly string[];
    readonly runningJobs: readonly string[];
}): string;
export interface PressurePolicyOptions {
    /** Resolve the live Agent of one Member. */
    readonly agentForMember: (memberId: AgentTeamMemberId) => Agent | undefined;
    /** Resolve the durable Member of one live Agent. */
    readonly memberForAgent: (agent: Agent) => {
        readonly memberId: AgentTeamMemberId;
        readonly sessionId: Agent['id'];
    } | undefined;
    /** Resolve the Member-scoped compaction engine. */
    readonly compactionForAgent: (agent: Agent) => CompactionEngine | undefined;
    /** Effective budgets for one Member's current route; undefined means the route window is unknown. */
    readonly limitsForAgent: (agent: Agent) => Promise<{
        readonly usageTokens: number;
        readonly hardLimit: number;
        readonly handoffAt: number;
    } | undefined> | {
        readonly usageTokens: number;
        readonly hardLimit: number;
        readonly handoffAt: number;
    } | undefined;
    /** The model-visible active-Claim labels for one Member's notice. */
    readonly activeClaimLabels: (memberId: AgentTeamMemberId) => readonly string[];
    /** The model-visible running-job labels for one Member's notice. */
    readonly runningJobLabels: (memberId: AgentTeamMemberId) => readonly string[];
    /** Report a Member failure with a recoverable diagnostic. */
    readonly failed: (memberId: AgentTeamMemberId, sessionId: Agent['id'], diagnostic: string) => void;
    /** Log one coordinator diagnostic. */
    readonly log: (message: string) => void;
}
export declare class PressurePolicyCoordinator {
    private readonly options;
    /**
     * Retry budget per agent for the current provider-overflow sequence.
     * Process-only by design: a restart re-earns one sequence per chain.
     */
    private readonly overflowRetries;
    /**
     * Whether the one-shot notice was already delivered, folded incrementally per
     * Member. The scan below is a monotone "has this ever happened" fold over the
     * Session's own events, so a cursor can replace re-scanning the whole log on
     * every step; identity guarding falls back to a cold fold when the Member's
     * Session changed under the entry.
     */
    private readonly noticeSeen;
    private disposed;
    constructor(options: PressurePolicyOptions);
    /**
     * The one-shot pressure notice is durable Session evidence, not process
     * state: a `CONTEXT_PRESSURE_NOTICE_SUMMARY` notice already surfaced as a
     * `user/message`, or still queued in a durable `agent/inbox/spliced`
     * insert (a steered notice surfaces only at the next step boundary, and a
     * Host restart replays the splice before surfacing), marks the current
     * generation as already notified. A resume or restart stays quiet; a
     * rollover starts a fresh Session whose own event span has no notice yet,
     * which is exactly the documented re-arm.
     */
    private noticeDelivered;
    dispose(): void;
    /** A successful assistant response ends any open overflow-recovery sequence. */
    onAssistantMessage(agent: Agent): void;
    /**
     * Pre-step policy for one Member agent: below the handoff budget nothing
     * happens; at the handoff budget one structured notice per generation is
     * steered into the running turn; at the hard limit the request is forced
     * through compaction first and fails closed when that cannot be proven.
     * Returns the decision for the step: `continue` forwards, `reject` blocks.
     */
    onPreStep(agent: Agent, signal: AbortSignal): Promise<{
        readonly kind: 'continue' | 'reject' | 'notice';
    }>;
    /**
     * Provider-overflow recovery: one bounded compact-and-retry sequence per
     * open failure chain. Returns whether the request may retry once.
     */
    onRequestError(agent: Agent, failure: {
        readonly code?: string;
    }, signal: AbortSignal): Promise<boolean>;
    /**
     * The one Team hard-limit translation: force a CompactionEngine reduction
     * in the current Agent/Session and prove it advanced the durable surface
     * (or measurably reduced pressure) before continuing. Background jobs are
     * untouched — compaction never cancels or discards them.
     * @returns whether the request may proceed.
     */
    private enforceHardLimit;
}
//# sourceMappingURL=pressure-policy.d.ts.map