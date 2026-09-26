/**
 * SophiaTeamFacade (design §4.2).
 *
 * The orchestration plane's public API: propose / setMode / review / approve /
 * materialize / list / activity. Materialize is the ONLY crossing point into a
 * backend — the facade resolves the request's mode and dispatches to the
 * matching TeamBackend (dag → DAG subagent teams, persistent → ledger-backed
 * Human/agent teams).
 *
 * Permissions (§4.3.2): `review` only for the team's captain; `approve` only
 * for the Human owner; `propose` open to everyone. Depth guard (§4.8):
 * members past `maxTeamDepth` levels may not propose new teams.
 */
import { ApprovalRouter, type NotifyEvent } from './router.ts';
import type { ActivitySnapshot, ApprovalPlan, ApprovalRequest, CaptainVerdict, MaterializeResult, OrchestrationHost, OwnerVerdict, TeamBackend, TeamFilter, TeamMode, TeamSummary } from './types.ts';
export interface FacadeOptions {
    workspace: string;
    host: OrchestrationHost & {
        workingDirectory: string;
    };
    dagBackend?: TeamBackend;
    persistentBackend?: TeamBackend;
    notify?: (event: NotifyEvent) => Promise<void>;
    now?: () => number;
}
/** Who is calling, resolved from the execution context by the tools layer. */
export interface CallerIdentity {
    /** True for the Human host session. */
    isHuman: boolean;
    /** Session id of the caller (member or captain). */
    sessionId?: string;
    /** Durable member handle when the caller is a member. */
    handle?: string;
    /** Current team id when the caller is a member of a team. */
    teamId?: string;
}
export declare class SophiaTeamFacade {
    private readonly options;
    readonly router: ApprovalRouter;
    private readonly dagBackend;
    private readonly persistentBackend;
    constructor(options: FacadeOptions);
    private get host();
    private workspace;
    private requesterOf;
    /** File a proposal (any caller). */
    propose(caller: CallerIdentity, input: {
        goal: string;
        plan?: ApprovalPlan;
        mode?: TeamMode;
    }): Promise<ReturnType<ApprovalRouter['propose']>>;
    /** Owner/Human picks the final backend mode before/while pending. */
    setMode(caller: CallerIdentity, requestId: string, mode: TeamMode): Promise<ReturnType<ApprovalRouter['setMode']>>;
    /** Captain verdict (captain-only, §4.3.2). */
    review(caller: CallerIdentity, requestId: string, verdict: Omit<CaptainVerdict, 'decidedBy' | 'decidedAt'>): Promise<ReturnType<ApprovalRouter['review']>>;
    /** Owner approval (Human-only, §4.3.2). */
    approve(caller: CallerIdentity, requestId: string, verdict: Omit<OwnerVerdict, 'decidedAt'>): Promise<ReturnType<ApprovalRouter['approve']>>;
    /**
     * THE single materialization dispatch point (§4.2). Publishes to the
     * backend matching the request's mode. Fails loudly when the backend is not
     * wired (host integration not yet attached).
     */
    materialize(request: ApprovalRequest, mode: TeamMode): Promise<MaterializeResult>;
    /** Cross-backend team listing for the workspace. */
    list(filter?: TeamFilter): Promise<TeamSummary[]>;
    /** Pending approval queue, newest first. */
    pendingApprovals(): Promise<ApprovalRequest[]>;
    /** Resolve one approval request. */
    get(requestId: string): Promise<ApprovalRequest | undefined>;
    /** Activity snapshots for a team ref (P4 expands). */
    activity(ref: {
        mode: TeamMode;
        teamRef: string;
    }): Promise<ActivitySnapshot>;
    /**
     * Run the timeout sweep. Hosts call this from a timer; tests call it with a
     * fake clock. Returns the transitions that fired.
     */
    sweepExpired(): Promise<Awaited<ReturnType<ApprovalRouter['sweepExpired']>>>;
    approvalsRoot(): string;
    private requireRequest;
}
//# sourceMappingURL=facade.d.ts.map