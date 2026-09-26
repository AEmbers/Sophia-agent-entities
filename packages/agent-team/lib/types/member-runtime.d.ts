/**
 * Per-Member runtime state extracted from the Agent Team Host service: the
 * cohesive per-Member maps and methods that must dispose together across
 * activation, edit, suspend, and removal — the tool-policy restriction seam,
 * the private skill selection/provider mounts, capability warnings, and
 * private-memory provisioning.
 *
 * This class is Host-side by design: its turn-boundary wait subscribes to
 * Host-level agent events, and every traceable-service registration goes
 * through contexts the Host already owns. The service keeps orchestration
 * (ledger, handles, notifications, recovery); this module owns per-Member
 * runtime invariants.
 *
 * @module dsh-sophia-entities/member-runtime
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { AgentHandle } from '@deepseek-ai/dsh-agent';
import type { AgentTeamAgentMember, AgentTeamCapabilityWarning, AgentTeamMemberCapabilities, AgentTeamMemberId } from './types.ts';
import type { MemberSkillSelectionRef } from './member-skills.ts';
/** Model-facing capabilities every Team-enabled preset must publish. */
export declare const AGENT_TEAM_TOOL_NAMES: readonly ["team_inbox", "team_thread", "team_message", "team_claim", "team_view", "context_rollover", "context_checkpoint", "context_timeline"];
/** Copy a Remote-supplied capability overlay into owned frozen storage. */
export declare function deepCopyCapabilities(capabilities: AgentTeamMemberCapabilities): AgentTeamMemberCapabilities;
/**
 * Filesystem directory segment for one Member's private memory namespace.
 * The `member:<uuid>` ref is a durable ledger identity and must never appear
 * in a path: Windows rejects `:` in a path segment (NTFS parses it as an
 * Alternate Data Stream separator), which made Member activation fail at its
 * first `mkdir` on Windows (issue #7).
 */
export declare function memberMemoryDirectoryName(memberId: AgentTeamMemberId): string;
/** The sanitized absolute private-memory path for one Member, regardless of what the ledger recorded. */
export declare function memberMemoryDirectoryPath(member: Pick<AgentTeamAgentMember, 'memberId' | 'privateMemoryPath'>): string;
/** Everything the runtime needs from its owning Host service. */
export interface MemberRuntimeDeps {
    /** Host context for agent events, tool schemas, and the workspace registry. */
    readonly ctx: Context;
    /** Resolve one Member's live agent context, or throw when it has none. */
    readonly liveMemberContext: (memberId: AgentTeamMemberId) => Context;
    /** Agent ids with a turn in flight; shared by reference with the service. */
    readonly runningAgents: ReadonlySet<SessionId>;
}
/** Per-Member runtime state; the four maps dispose together with each Member. */
export declare class MemberRuntime {
    private readonly deps;
    /**
     * Live per-Member tool restriction disposers, mirroring modelSelections:
     * activation registers, disposal paths release, edits swap at a turn
     * boundary. Deliberate interface reservation: the restriction seam is the
     * primitive future Runtime Revision manifests orchestrate — do not remove
     * during cleanup.
     */
    private readonly memberRestrictions;
    /**
     * Runtime-derived capability warnings, recomputed at every activation (like
     * memberFailures, keyed by Member and never persisted): persisted warnings
     * would lie after a Host restart or a Harness upgrade renames tools.
     */
    private readonly capabilityWarnings;
    /** Live skill selection refs let capability edits re-filter the catalog without disposing the Session. */
    private readonly skillSelections;
    /** Per-Member private skill provider disposers; released with the Member's agent scope. */
    private readonly skillProviderDisposals;
    constructor(deps: MemberRuntimeDeps);
    /** One Member's live capability warnings, if any; runtime-derived, never persisted. */
    capabilityWarningsFor(memberId: AgentTeamMemberId): readonly AgentTeamCapabilityWarning[] | undefined;
    /**
     * Apply one Member's persisted tool allow-list as a scoped restriction on
     * the freshly composed preset surface, and derive activation-time warnings
     * for entries the current tool surface no longer knows. Runs inside setup
     * BEFORE validateMemberPreset so the validation observes the restricted
     * view (the Host always unions the five Team tools over the configured
     * list). Deliberate interface reservation: this restriction seam is the
     * primitive future Runtime Revision manifests orchestrate — do not remove
     * during cleanup.
     */
    applyMemberToolPolicy(agentCtx: Context, member: AgentTeamAgentMember): void;
    /** Swap a live Member's tool policy at a turn boundary: dispose the old restriction, apply the new. */
    reapplyMemberToolPolicy(member: AgentTeamAgentMember): void;
    /** Release one Member's restriction disposer and warning state; safe to call twice. */
    releaseMemberToolPolicy(memberId: AgentTeamMemberId): void;
    private setCapabilityWarnings;
    /**
     * Wait until one live Member's current turn ends or its Session is
     * disposed. While the Agent runs, the current turn keeps its schemas and
     * catalog; the swap happens once idle, so the next step recomputes schemas
     * from the new restriction and the durable replacement skill catalog from
     * the new selection, with the same Session and history surviving.
     * Suspend/remove during the wait resolves it — the disposed handle released
     * the old restriction already and no disposer leaks. Returns whether any
     * wait happened, so the caller can re-check the handle afterwards.
     */
    awaitTurnBoundary(active: AgentHandle): Promise<boolean>;
    /**
     * Register the Member-private skill provider on the created agent's exact
     * scope layer (the traceable-service seam, like the tool restriction):
     * bundled read-only core skills plus this Member's own private directory,
     * with the live selection ref that later capability edits swap in place.
     * The sanitized directory is authoritative: activateMember migrated any
     * legacy colon directory onto it before the provider mounted.
     */
    mountMemberSkillProvider(member: AgentTeamAgentMember, agentCtx: Context, selection: MemberSkillSelectionRef): void;
    /** Live-apply a capability edit to a registered selection; a no-op when none exists. */
    swapSkillSelection(memberId: AgentTeamMemberId, allow: readonly string[] | undefined): void;
    /**
     * Provision one Member's private memory namespace: notes/, skills/, and a
     * first-run memory.md scaffold. The Member-private skills directory starts
     * empty; the per-Member provider scans exactly this root (default roots
     * excluded).
     *
     * Existing installs recorded the pre-fix colon directory in the ledger, and
     * `privateMemoryPath` is a durable Member fact the renewal path cannot
     * rewrite: when the legacy directory exists it is renamed onto the sanitized
     * path once (same-parent rename, atomic), so existing private memory
     * survives instead of being silently orphaned. A recorded path that names a
     * different DSH home is never acted on — see `migrateLegacyMemoryDirectory`.
     *
     * A colon-form twin directory is also merged when it exists: a Member may
     * have written files under the ledger identity spelling (the branded
     * `member:<uuid>` ref is what every Team tool result shows, so a
     * hand-assembled path carries the colon). Linux accepts the segment
     * silently — two directories for one Member — while Windows would have
     * failed the write outright. The twin is never a durable-Member-Fact
     * candidate: only the files the Member actually wrote there are worth
     * keeping, and `memory.md` cannot merge, so the sanitized copy always wins
     * and twin-only notes/skills are moved in without overwriting.
     */
    initializePrivateMemory(path: string, legacyPath?: string): Promise<void>;
    /** Irreversibly remove one Member: archive its Session and delete its private namespace. */
    cleanupRemovedMember(member: AgentTeamAgentMember): Promise<void>;
    /** Drop one Member's transient selection/disposer state after its handle is gone; safe to call twice. */
    forgetMember(memberId: AgentTeamMemberId): void;
    /** Dispose every registered per-Member seam; service shutdown only. */
    disposeAll(): void;
}
//# sourceMappingURL=member-runtime.d.ts.map