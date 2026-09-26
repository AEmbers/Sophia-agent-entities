/**
 * Team's projection contribution to the context-continuity engine: the durable
 * ref naming, the Team-notice rule, and the domain judgement that decides which
 * events anchor a timeline boundary and what each boundary is attributable to.
 *
 * The fold itself is the engine's (`createContextProjectionDefinition`): one
 * registered unit per Host folds every Session's durable log and owns the
 * universal structure — checkpoints, the pending rollover intent, quiet
 * continuation delivery, carry candidates, open calls, turn cursors. This
 * module supplies only what the engine deliberately refuses to know:
 *
 * - the durable refs Team's existing logs already carry
 *   (`context-checkpoint-<sha256>`, `team-boundary-<sha256>`), frozen because
 *   recorded history is read back through them;
 * - which queued messages are Team-owned notices the successor rederives;
 * - which successful Team calls anchor a boundary, and which Threads each
 *   boundary is attributable to. A claim mutation resolves its Task's Thread
 *   through the ledger; that binding is written once at Task creation, so a
 *   re-fold reproduces the same attribution, and a missing ledger or mapping
 *   yields no attribution instead of failing the fold.
 *
 * The remaining exports are read views over the engine's state that Team still
 * owns: the anchor lookups the rollover guard revalidates a cited ref through,
 * the accumulated Thread attribution that guard and the timeline both judge a
 * boundary by, and carried-message resolution — the engine keys carry
 * candidates by message id, and the durable log is where the message body
 * lives.
 * @module dsh-sophia-entities/context-projection
 */
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { CONTEXT_CHECKPOINT_TOOL_NAME, CONTEXT_ROLLOVER_TOOL_NAME, createContextProjectionDefinition, type ContextCheckpointEntry, type ContextFoldTarget, type ContextProjectionConfig, type ContextProjectionHost, type ContextProjectionState, type DomainBoundary, type DomainBoundaryContribution, type DomainBoundaryInput } from '@wowyuarm/dsh-context-continuity';
import type { AgentTeamContextCheckpointRef, AgentTeamTaskRef, AgentTeamThreadRef } from './types/entities.ts';
/** Whether one notice summary is a pure reminder (never a semantic Team fact). */
export declare function isReminderNoticeSummary(summary: string): boolean;
/** Stable tool names the fold recognizes under their current names. */
export { CONTEXT_CHECKPOINT_TOOL_NAME, CONTEXT_ROLLOVER_TOOL_NAME };
/**
 * Legacy decoder name: the rollover tool was renamed `new_context` →
 * `context_rollover`, and Sessions recorded before the rename still carry
 * durable `new_context` call/result pairs. The fold keeps decoding them —
 * pending rollovers and crash recovery of existing Members depend on old
 * events still resolving intent — but this is a log decoder, not a tool
 * alias: no new call can carry the old name.
 */
export declare const NEW_CONTEXT_TOOL_NAME = "new_context";
/** Every recorded tool name a rollover call may carry, current name first. */
export declare const TEAM_ROLLOVER_TOOL_NAMES: readonly string[];
/**
 * Deterministic checkpoint ref from the recording session and tool call
 * identity: a bounded, collision-resistant opaque token. Provider call ids
 * are arbitrary-length free text that may repeat across generations and even
 * collide between Sessions, so the ref derives from the SHA-256 of the exact
 * `(sessionId, callId)` pair — same pair always reproduces the ref, any
 * other pair is overwhelmingly unlikely to collide, and the token can never
 * smuggle delimiters or unbounded content through a ref field.
 */
export declare function checkpointRefFor(sessionId: string, callId: string): AgentTeamContextCheckpointRef;
/**
 * Deterministic boundary ref for one delivered Team boundary: the same
 * session-scoped hash shape as checkpoint refs, keyed on the boundary's
 * anchoring event seq. Consecutive generations routinely repeat event seqs,
 * so the Session identity must be part of the key or two generations'
 * boundaries at the same seq collide — the timeline would silently drop the
 * ancestor item and a `context_rollover` return would resolve the wrong boundary.
 */
export declare function boundaryRefFor(sessionId: string, seq: number): AgentTeamContextCheckpointRef;
/**
 * Whether one queued message is a Team-owned notice the rederived Inbox
 * replaces. Handoff and continuation envelopes carry the same plugin
 * attribution but are ordinary delivered context the new generation keeps, so
 * they are excluded rather than dropped.
 */
export declare function isTeamNotice(message: UserMessage): boolean;
/** What Team's fold needs from the rest of the Host. */
export interface TeamContextProjectionOptions {
    /**
     * Resolve the Thread one Task's facts belong to, for claim-boundary
     * attribution. Absent (or returning undefined) leaves the boundary
     * unattributed: it still anchors the timeline, it is simply not selectable
     * as a single-Thread return target.
     */
    readonly threadForTask?: (taskRef: AgentTeamTaskRef) => AgentTeamThreadRef | undefined;
}
/**
 * Team's domain half of the context-continuity projection. Every method is a
 * pure judgement over the event the engine hands it plus Team's own durable
 * vocabulary; the engine keeps the state machine.
 */
export declare class TeamContextProjectionHost implements ContextProjectionHost {
    private readonly options;
    constructor(options?: TeamContextProjectionOptions);
    /** Durable checkpoint ref: Team's existing log vocabulary, unchanged. */
    checkpointRefFor(sessionId: string, toolCallId: string): AgentTeamContextCheckpointRef;
    /** Durable boundary ref: the same session-scoped hash shape. */
    boundaryRefFor(sessionId: string, seq: number): AgentTeamContextCheckpointRef;
    /** A Team-owned notice the successor generation rederives from ledger facts. */
    isEphemeralNotice(message: UserMessage): boolean;
    /**
     * Only a Team-effect call that can produce a boundary is tracked at all:
     * `list` on a claim, `read` on a Thread, and `dm` are not semantic timeline
     * candidates, so their results must never open an anchor.
     */
    tracksCall(name: string, raw: string): boolean;
    /** Team's boundary for one event, or undefined when the event anchors nothing. */
    domainBoundaryOf(input: DomainBoundaryInput): DomainBoundaryContribution | undefined;
    /**
     * Structural boundary from one delivered user message: a rollover handoff
     * starts a generation; a compaction notice rewrites the visible surface. A
     * structured Team notification is a boundary ONLY on the first arrival of
     * each Thread's facts into this Session — the preserved "work just arrived"
     * anchor; every later re-delivery of the same Thread is noise. Reminder
     * notices (progress nudges, recovery instructions) never anchor. Plain
     * Human/agent prose and quiet checkpoint continuations are not boundaries.
     */
    private boundaryFromUserMessage;
    /**
     * Effect boundary from one successful Team-effect call — the attribution
     * matrix: claim mutation → the Thread its Task was created in (resolved
     * through the ledger, whose binding is immutable); team_message committed →
     * the Thread from the call arguments or, for a start, from the structured
     * presentation meta (`kind === 'committed'` guards every typed rejection; no
     * meta means no boundary — old logs refold without start anchors by design,
     * never by parsing render text); team_thread follow/unfollow → the threadRef
     * from its call arguments. An unresolvable attribution leaves the boundary
     * anchored but not single-Thread selectable.
     */
    private boundaryFromToolResult;
}
/**
 * The engine fold configured for Team: the codec Team's durable envelopes are
 * written with, Team's projection host, and every recorded rollover name
 * (current and legacy). One config drives both the registered unit and every
 * cold fold, so a replayed log and the live unit converge on one state.
 */
export declare function createTeamContextProjectionConfig(host: ContextProjectionHost): ContextProjectionConfig;
/**
 * Cold-fold one immutable Team Session log through the engine's fold with
 * Team's config. The registered unit uses the same config, so the two agree.
 */
export declare function foldTeamContextProjection(events: readonly SessionEvent[], target: ContextFoldTarget, host?: ContextProjectionHost): ContextProjectionState;
/**
 * The host-only projection unit for Team Members. Register it **once per
 * Host**: the framework keeps one unit per projection key and drives it for
 * every Session, so the definition closes over no Session identity.
 */
export declare function createTeamContextProjectionDefinition(host: ContextProjectionHost): ReturnType<typeof createContextProjectionDefinition>;
/**
 * The Threads Team's own fold attributed to boundaries resolved by one
 * completed turn, order-stable and deduplicated: a delivered notice's first
 * arrival, a claim mutation's Task→Thread binding, a committed Thread effect.
 *
 * This is the accumulated attribution of the RETAINED PREFIX through that
 * turn, and it is one set with two readers — the timeline publishes it as the
 * item's affected Threads, and the rollover guard refuses a boundary whose
 * prefix spans more than one Thread, so a ref the timeline offers is a ref
 * `context_rollover` accepts.
 */
export declare function retainedTopicsThrough(state: ContextProjectionState, turnEndSeq: number): readonly string[];
/** Find one resolved checkpoint entry by its stable ref, if it exists. */
export declare function checkpointByRef(state: ContextProjectionState, checkpointRef: string): ContextCheckpointEntry | undefined;
/** Whether one engine-held boundary is the recorded anchor of `ref` in this state's Session. */
export declare function boundaryByRef(state: ContextProjectionState, ref: string): DomainBoundary | undefined;
/**
 * The carried input one transition must deliver: unconsumed post-intent
 * candidates in queue order, resolved to their durable message bodies. The
 * engine keys carry candidates by message id (that is what the transition
 * dedupes on); the `agent/inbox/spliced` events that recorded them are where
 * the message itself lives, so the log stays the only authority.
 */
export declare function carriedInputOf(state: ContextProjectionState, events: readonly SessionEvent[]): readonly UserMessage[];
//# sourceMappingURL=context-projection.d.ts.map