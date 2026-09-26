import type { ApprovalPlan, ApprovalRequest, ApprovalState, CaptainVerdict, MaterializeResult, OwnerVerdict, Requester, TeamMode } from './types.ts';
export declare const DEFAULT_TIMEOUTS: {
    readonly pendingCaptainMs: number;
    readonly pendingOwnerMs: number;
    readonly draftMs: number;
};
export interface RouterTimeouts {
    pendingCaptainMs?: number;
    pendingOwnerMs?: number;
    draftMs?: number;
}
/** Terminal states that stay on disk as the audit trail. */
export declare function isTerminalState(state: ApprovalState): boolean;
export interface NotifyEvent {
    /** Why this notification fired. */
    kind: 'owner_needed' | 'expired' | 'escalated';
    request: ApprovalRequest;
}
export interface RouterOptions {
    now?: () => number;
    timeouts?: RouterTimeouts;
    /** Called after a decision that must reach the owner through out-of-band channels (P4 wires the real notifiers). */
    notify?: (event: NotifyEvent) => Promise<void>;
}
export type MaterializeHook = (request: ApprovalRequest, mode: TeamMode) => Promise<MaterializeResult>;
export interface ProposeInput {
    goal: string;
    plan?: ApprovalPlan;
    mode?: TeamMode;
}
export interface TransitionResult {
    request: ApprovalRequest;
    /** Present when this transition materialized a team (or encountered a materialize error holding the state). */
    materialized?: MaterializeResult;
    /** True when duplicated an existing non-terminal proposal instead of creating a new one. */
    duplicate?: boolean;
}
/** Stores a transition outcome that failed AFTER the record changed. */
export declare class MaterializeError extends Error {
    readonly request: ApprovalRequest;
    constructor(message: string, request: ApprovalRequest);
}
export declare class ApprovalRouter {
    private readonly workspace;
    private readonly host;
    private readonly store;
    private readonly getNow;
    private readonly timeouts;
    private readonly notify;
    /** Dispatches to the correct backend; assigned by the facade. */
    private materializeHook;
    constructor(workspace: string, host: {
        workingDirectory: string;
    }, options?: RouterOptions);
    /** Set the materialize hook (called once by the facade). */
    setMaterializeHook(hook: MaterializeHook): void;
    private root;
    /**
     * File the goal/plan hashes from the plan so the same proposal is not filed
     * twice while a non-terminal request exists (§4.8 point 4).
     */
    private findDuplicate;
    /**
     * Receive a proposal.
     *
     * - human requester → `pending_owner` (mode may still be picked on the card)
     * - member requester with explicit mode → `pending_captain`
     * - member requester without mode → `draft` until the mode is set
     */
    propose(requester: Requester, input: ProposeInput): Promise<TransitionResult>;
    /** Switch the intended backend of a request whose mode is still open (draft or pending_owner). */
    setMode(requestId: string, mode: TeamMode): Promise<TransitionResult>;
    /** Captain review of a member proposal (approve_dag / approve_persistent / downgrade_to_dag / reject). */
    review(requestId: string, verdict: CaptainVerdict): Promise<TransitionResult>;
    /** Owner decision on a request awaiting the owner (approve with chosen mode, or reject). */
    approve(requestId: string, verdict: OwnerVerdict): Promise<TransitionResult>;
    /**
     * Apply the timeout table to every stored request. Returns the transitions
     * that happened. Safe to call repeatedly (idempotent per state).
     */
    sweepExpired(): Promise<TransitionResult[]>;
    /** Pure expiry transition for one request (exposed for tests). */
    expireTransition(request: ApprovalRequest, now: number): {
        request: ApprovalRequest;
        kind: 'escalated' | 'expired';
    } | undefined;
    listAll(): Promise<ApprovalRequest[]>;
    get(requestId: string): Promise<ApprovalRequest | undefined>;
    private requireRequest;
    /**
     * Attempt materialization; on backend failure the request stays in its
     * pre-materialization state so the decision is not burned by a transient
     * backend error (§4.2 "materialize 唯一分派点").
     */
    private materializeOrHalt;
}
//# sourceMappingURL=router.d.ts.map