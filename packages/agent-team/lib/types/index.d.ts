/**
 * Durable Agent Team Host capability.
 *
 * The Host owns the append-only collaboration ledger and all Member lifecycle
 * effects. Session history and browser state are projections, never Team facts.
 * @module dsh-sophia-entities
 */
import { Context, Service, type Volatile } from '@deepseek-ai/cordis';
import { type Agent } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace';
import { type ContextProjectionConfig, type ContextTimelineSource } from '@wowyuarm/dsh-context-continuity';
import { type AgentTeamDurableMemberResult } from './ledger.ts';
import type { AgentTeamAddMemberRequest, AgentTeamAddMemberResult, AgentTeamAgentMember, AgentTeamAgentMemberStatus, AgentTeamArchiveChannelRequest, AgentTeamArchiveChannelResult, AgentTeamArchiveMemberRequest, AgentTeamArchiveMemberResult, AgentTeamChangesRequest, AgentTeamChangesResult, AgentTeamClaimList, AgentTeamClaimRequest, AgentTeamClaimResult, AgentTeamClientMemberStatus, AgentTeamContextCheckpointRef, AgentTeamCreateChannelRequest, AgentTeamCreateChannelResult, AgentTeamGetAttachmentRequest, AgentTeamGetAttachmentResult, AgentTeamGetHumanAvatarRequest, AgentTeamGetHumanAvatarResult, AgentTeamHumanProfileRequest, AgentTeamHumanProfileResult, AgentTeamPutHumanAvatarRequest, AgentTeamPutHumanAvatarResult, AgentTeamRemoveHumanAvatarRequest, AgentTeamRemoveHumanAvatarResult, AgentTeamInbox, AgentTeamInboxRequest, AgentTeamJoinChannelRequest, AgentTeamJoinChannelResult, AgentTeamJoinWorkspaceRequest, AgentTeamJoinWorkspaceResult, AgentTeamLeaveWorkspaceRequest, AgentTeamLeaveWorkspaceResult, AgentTeamMemberId, AgentTeamMemberResult, AgentTeamMembersRequest, AgentTeamResolveTaskRefsRequest, AgentTeamResolveTaskRefsResult, AgentTeamResolveThreadRefsRequest, AgentTeamResolveThreadRefsResult, AgentTeamOperationReceipt, AgentTeamPromoteThreadRequest, AgentTeamPromoteThreadResult, AgentTeamPutAttachmentRequest, AgentTeamPutAttachmentResult, AgentTeamRecoverMemberRequest, AgentTeamRecoverMemberResult, AgentTeamClearMemberContextRequest, AgentTeamClearMemberContextResult, AgentTeamRolloverSessionRequest, AgentTeamDmRequest, AgentTeamDmResult, AgentTeamRemoveChannelMemberRequest, AgentTeamRemoveChannelMemberResult, AgentTeamRemoveMemberRequest, AgentTeamRemoveMemberResult, AgentTeamReplyRequest, AgentTeamReplyResult, AgentTeamSendMessageRequest, AgentTeamSendMessageResult, AgentTeamSetHumanProfileRequest, AgentTeamSetHumanProfileResult, AgentTeamSetMemberStateRequest, AgentTeamStatus, AgentTeamTask, AgentTeamTaskRequest, AgentTeamTaskResult, AgentTeamThreadAttentionRequest, AgentTeamThreadAttentionResult, AgentTeamThreadAttentionStatus, AgentTeamThreadHistory, AgentTeamThreadHistoryRequest, AgentTeamThreadReadRequest, AgentTeamThreadReadResult, AgentTeamThreadObservations, AgentTeamThreadObservationsRequest, AgentTeamUpdateChannelRequest, AgentTeamUpdateChannelResult, AgentTeamUpdateMemberRequest, AgentTeamView, AgentTeamViewRequest } from './types.ts';
export { agentTeamDomainSpec, agentTeamOperationSchema } from './spec.ts';
export type * from './types.ts';
export { AGENT_TEAM_HUMAN_HANDLE, AGENT_TEAM_HUMAN_MEMBER_ID, AGENT_TEAM_INITIALIZE_REQUEST_ID } from './ledger.ts';
export { HUMAN_PROFILE_DEFAULT_NAME, HUMAN_PROFILE_REPO_URL, HUMAN_PROFILE_SETTINGS_NAMESPACE, HUMAN_PROFILE_SETTINGS_SCHEMA, HUMAN_PROFILE_VERSION, assertValidHumanName, normalizeHumanName } from './human-profile.ts';
export { humanAvatarsRoot } from './human-avatar.ts';
export { AGENT_TEAM_TOOL_NAMES } from './member-runtime.ts';
/** Process-stable marker carried by the final Team message tool definition. */
export declare const AGENT_TEAM_PRESET_MARKER: unique symbol;
/** Mark the preset's `team_message` definition as an Agent Team consumer. */
export declare function markAgentTeamPreset<T extends object>(definition: T): T;
/**
 * Whether the running dsh loads workspace packages from source via tsx.
 *
 * The Harness `tsconfig.base.json` maps `@deepseek-ai/*` package names onto
 * `src/` directories; tsx honors those paths, so a CLI launched with
 * `node --import tsx/esm apps/cli/src/bin.ts` imports `@deepseek-ai/dsh-scope`
 * from `src/index.ts` while a profile-installed bundle resolves the compiled
 * `lib/index.js` — two module instances with independent scope keys.
 */
export declare function isTsxDevMode(): boolean;
/**
 * The activation diagnostic for a dsh-scope module-instance mismatch.
 *
 * `agentPresets.mount` already rejected an unscoped context, so a scope key
 * the harness sees but this bundle does not can only mean the two sides
 * loaded different physical copies of `@deepseek-ai/dsh-scope`.
 */
export declare function teamPresetScopeMismatchMessage(tsxDevMode: boolean): string;
export interface AgentTeamCommitted {
    readonly receipt: AgentTeamOperationReceipt;
}
/**
 * A DM was durably recorded but its session injection could not run (no live
 * handle, or the wake itself failed). The recorded DM stays durable; the
 * sender should not blindly retry — the recipient recovers it through its DM
 * history once its session is live again.
 */
export declare class AgentTeamDmDeliveryError extends Error {
    readonly recipientMemberId: AgentTeamMemberId;
    readonly recipientHandle: string;
    constructor(recipientMemberId: AgentTeamMemberId, recipientHandle: string, message: string);
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        agentTeam: AgentTeam;
    }
    interface Events {
        /** One new Team operation is durable and visible through Host projections. */
        'agent-team/committed'(event: AgentTeamCommitted): void;
    }
}
/** Tool-side request for one context rollover; the Host validates without side effects. */
export interface AgentTeamNewContextToolRequest {
    readonly memberId: AgentTeamMemberId;
    /** Selected checkpoint ref from `context_timeline`; absent means fresh. */
    readonly checkpointRef?: AgentTeamContextCheckpointRef;
    readonly relatedFiles?: readonly {
        readonly path: string;
        readonly reason: string;
    }[];
}
/** Tool-side validation outcome: which rollover mode a successful call will take. */
export interface AgentTeamNewContextToolOutcome {
    readonly mode: 'fresh' | 'from-checkpoint';
}
/** Tool-side request for one explicit checkpoint; the Host validates without side effects. */
export interface AgentTeamCheckpointToolRequest {
    readonly memberId: AgentTeamMemberId;
    /** Provider-issued call id of this tool call; the stable ref derives from it. */
    readonly callId: string;
    readonly name: string;
}
/** Tool-side checkpoint validation outcome: the deterministic ref the result will carry. */
export interface AgentTeamCheckpointToolOutcome {
    readonly checkpointRef: AgentTeamContextCheckpointRef;
    readonly name: string;
}
/** Tool-side request for the bounded structural context timeline. */
export interface AgentTeamTimelineToolRequest {
    readonly memberId: AgentTeamMemberId;
    readonly limit?: number;
}
/** One structural timeline item: a checkpoint or boundary candidate with pricing. */
export interface AgentTeamTimelineItem {
    /** Opaque stable ref; the selection surface for `context_rollover.checkpointRef`. */
    readonly checkpointRef: string;
    /** Semantic label: the model-supplied checkpoint name or boundary label. */
    readonly name: string;
    /** Which structural source produced this item. */
    readonly source: 'agent' | 'team-boundary' | 'handoff' | 'compaction' | 'head';
    /** Approximate tokens a return would retain (the prefix through this anchor). */
    readonly retainedTokens: number;
    /** Approximate tokens a return would discard (the suffix after this anchor). */
    readonly discardedTokens: number;
    /**
     * Threads whose facts entered this Session's model context by this anchor
     * (delivered Team notices only — never unread ledger activity). Empty when
     * nothing attributable was delivered.
     */
    readonly affectedThreads: readonly string[];
    /** Whether `context_rollover` accepts this ref as a seed target. */
    readonly restorable: boolean;
    /** When not restorable, the concise reason. */
    readonly reason?: string;
    /** Session the candidate anchors in; present for non-current-generation sources. */
    readonly sourceSessionId?: SessionId;
}
/** Tool-side timeline outcome: usage plus the bounded structural candidate list. */
export interface AgentTeamTimelineToolResult {
    readonly usageTokens: number;
    readonly hardLimit: number;
    readonly handoffAt: number;
    readonly items: readonly AgentTeamTimelineItem[];
    /**
     * The unreadable ancestor that ended the lineage walk early, when one did:
     * history is complete through the last listed source and provably absent
     * beyond it. Never a Member-availability fact.
     */
    readonly incompleteFrom?: {
        readonly sessionId: SessionId;
        readonly reason: string;
    };
}
/**
 * Config of the Team Host row: the Human profile (see human-profile.ts). The
 * settings service derives every form from the owning plugin's Config, so the
 * profile is this plugin's own config rather than a section of its own; both
 * fields arrive volatile, which is what lets an edit reach the running Host
 * without remounting it.
 */
export interface Config {
    name: Volatile<string>;
    avatarRef: Volatile<string | undefined>;
}
/** Host owner of the single Agent Team in one dshHome. */
export default class AgentTeam extends TypertRemoteService {
    config: Config;
    static Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        name: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        avatarRef: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
    }>>, Schemastery.ObjectT<NoInfer<{
        name: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        avatarRef: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
    }>>, "plain">;
    static inject: string[];
    private domain?;
    private ledger?;
    private readonly handles;
    /** Live Member per session id; drives the root session/event listener. */
    private readonly memberBySessionId;
    /** Live selection refs let model edits take effect without disposing the Session. */
    private readonly modelSelections;
    /** Agent ids with a turn in flight; restarts must wait for the boundary. */
    private readonly runningAgents;
    /** Per-Member runtime state: tool restrictions, skill mounts, warnings, private memory. */
    private readonly memberRuntime;
    /**
     * The single seam for every per-Session stored read: handle lifecycle and
     * failure normalization live here, so a DSH persistence-interface change is
     * adapted once, and consumers choose policy by failure category instead of
     * matching error text.
     */
    private readonly sessionReader;
    /**
     * Why one Member shows error presence, per failure source. Reads prefer
     * activation, then runtime, then compaction; slots clear independently, so
     * a recovered runtime error re-reveals an outstanding compaction failure.
     * Keyed by Member rather than Session so a restarted Session cannot leak
     * stale keys.
     */
    private readonly memberFailures;
    private readonly pressurePolicy;
    private readonly notifiedInbox;
    private attachmentGcTimer?;
    /**
     * New-release check behind the settings footnote. Memory-only and
     * background-refreshed, so the profile read path never waits on the
     * network and every failure settles as "no update known".
     */
    private readonly humanUpdateCheck;
    private readonly recovery;
    /**
     * Team's domain half of the continuity projection: the durable ref naming,
     * the Team-notice rule, and the boundary judgement (committed messages,
     * claim changes, first Thread arrivals). Its claim attribution resolves the
     * Task's Thread through the ledger, which is why the resolver reads
     * `this.ledger` lazily — the fold may run before the domain is open, and an
     * unattributed boundary is still a valid anchor.
     */
    private readonly contextProjectionHost;
    /**
     * Context self-management: the one deep module that turns a Member's
     * successful `context_rollover` tool result into its next private context
     * generation. The ledger owns the binding audit, the engine's projection
     * unit owns intent, and this coordinator owns only reconstructible process
     * state. See docs/architecture/README.md and docs/team-collaboration/README.md.
     */
    private readonly contextManagement;
    private lifecycleTail;
    private accepting;
    /** One adoption attempt per boot: the two readiness edges fire once each, and this keeps their attempt single. */
    private legacyAdoptionStarted;
    /**
     * Presence wake epoch: Agent running/idle/failure is runtime state with no
     * durable fact behind it, so the presence scope counts those edge wakes in
     * process. It never takes part in a projection waiter's comparison.
     */
    private presenceEpoch;
    private readonly changeWaiters;
    constructor(ctx: Context, config: Config);
    /** Current human display name; the single source for team_view and @ matching. */
    humanHandle(): string;
    /** Current human profile reference held in this Host row's Config (name + avatarRef). */
    humanProfile(): {
        readonly name: string;
        readonly avatarRef?: string | undefined;
    };
    /** Push the current Config name into the ledger's runtime @ handle. */
    private syncHumanHandle;
    /**
     * The two judgements the Config schema cannot make about a Human name: the
     * same non-empty floor as Member handles, plus global uniqueness against live
     * Members. `setHumanProfile` runs it before the write, so a colliding rename
     * rejects instead of persisting.
     */
    private validateHumanProfile;
    /**
     * One-time adoption of the profile facts the retired `agent-team-human`
     * settings section held (see `LEGACY_HUMAN_PROFILE_SECTION` for why the
     * upstream importer cannot carry them over). The values land in this Host
     * row's own Config through the same Remote the profile page writes, so the
     * page, the ledger's @ handle, and every avatar seat follow as after any
     * edit. Readiness has two one-way edges — the settings service arrives, the
     * ledger opens — and whichever fires second starts the attempt; only a
     * pristine profile is adopted, and one attempt per boot is its whole
     * lifetime, so adoption never loops and never re-writes.
     */
    private adoptLegacyHumanProfile;
    /** Carry the first legacy document that still has the section into a pristine profile. */
    private adoptLegacyHumanProfileNow;
    /** Open the durable ledger and restore every enabled Member independently. */
    protected [Service.init](): Promise<void>;
    /**
     * Lazy Workspace-deletion handling: a Workspace that no longer exists can
     * only be detected through the registry — there is no deletion event. A
     * dead non-default participation is withdrawn here (its Claims and
     * Attention release through the normal leave path); a dead default
     * Workspace is left alone — activation fails on its missing cwd and the
     * Member surfaces as unavailable for Human attention.
     */
    private sweepWorkspaceParticipations;
    /**
     * Whether one Member Session has durable persisted content, decided through
     * {@link SessionPersistence.stat} rather than a bare metadata listing: the
     * backend reports a still-draining session through its pending header, so a
     * resume racing a suspend's fire-and-forget final flush cannot mistake a
     * still-draining persisted Session for an unpersisted one and fork a fresh
     * generation over it.
     */
    private sessionPersisted;
    /** Resolve one exact live Agent to its durable Team Member; forks do not inherit identity. */
    memberForAgent(agent: Agent): AgentTeamAgentMember | undefined;
    /** Return every durable Member with current process availability. */
    members(): readonly AgentTeamAgentMemberStatus[];
    /** Read-only navigation lookup for branded Task refs found in message bodies. */
    resolveTaskRefs(request: AgentTeamResolveTaskRefsRequest): AgentTeamResolveTaskRefsResult;
    /** Read-only navigation lookup for branded Thread refs found in message bodies. */
    resolveThreadRefs(request: AgentTeamResolveThreadRefsRequest): AgentTeamResolveThreadRefsResult;
    /** Browser-safe Human roster, optionally filtered to one participation. */
    membersForClient(request: AgentTeamMembersRequest): readonly AgentTeamClientMemberStatus[];
    /** Emit a current baseline, then coalesced invalidations until canceled. */
    changes(request: AgentTeamChangesRequest, signal?: AbortSignal): AsyncIterable<AgentTeamChangesResult>;
    /** Return durable Team status without issuing a model request or a storage write. */
    status(): AgentTeamStatus;
    createChannel(request: AgentTeamCreateChannelRequest): Promise<AgentTeamCreateChannelResult>;
    /** Human rename of one Channel's display facts; identity refs are immutable. */
    updateChannel(request: AgentTeamUpdateChannelRequest): Promise<AgentTeamUpdateChannelResult>;
    /**
     * Archive one Channel: hidden from every surface with all facts kept. Pure
     * ledger projection change — Member sessions stay live (they may work in
     * other Channels), every active Claim on the Channel's Threads releases,
     * and affected Members' Attention clears.
     */
    archiveChannel(request: AgentTeamArchiveChannelRequest): Promise<AgentTeamArchiveChannelResult>;
    /** Create a durable Member and atomically grant its declared initial Channels. */
    addMember(request: AgentTeamAddMemberRequest): Promise<AgentTeamAddMemberResult>;
    /** Commit suspended intent, then wait for the owned AgentHandle to become quiescent. */
    suspendMember(request: AgentTeamSetMemberStateRequest): Promise<AgentTeamMemberResult>;
    /** Commit enabled intent and restore the exact persisted Session. */
    resumeMember(request: AgentTeamSetMemberStateRequest): Promise<AgentTeamMemberResult>;
    /**
     * Operator nudge for a Member that stopped making progress: steer a
     * continuation prompt into its live session, rebuild it after an orphaned
     * preset composition, or re-run activation when no live session exists.
     * Runtime-only — no ledger operation, no suspend. Taking over manually also
     * cancels any pending automatic recovery episode.
     */
    recoverMember(request: AgentTeamRecoverMemberRequest): Promise<AgentTeamRecoverMemberResult>;
    /**
     * Start one enabled Member from a new context: dispose the live handle,
     * archive the previous Session (its log stays on disk for history), and
     * activate a fresh Session under a new sessionId, so preset, tools, private
     * memory, and model selection all reload while the next turn carries no
     * history. The durable operation moves the Member's sessionId; identity,
     * memory path, and binding survive. A new id is what keeps the Web Client
     * seat live: a disposed generation's resident instance keeps its `removed`
     * bit forever, so renewing under the same id would leave a permanently
     * grayed session view.
     */
    clearMemberContext(request: AgentTeamClearMemberContextRequest): Promise<AgentTeamClearMemberContextResult>;
    /**
     * Retire one Member's previous generation after its durable binding moved
     * onto a new Session id: drop the old handle's transient state, dispose the
     * Agent, and archive the old Session log (which stays on disk for history).
     * Shared by the Human clear path and the model-initiated rollover.
     */
    private retireMemberGeneration;
    /**
     * Execute one prepared context rollover at a true idle boundary: commit the
     * idempotent Member-actor operation, retire the previous generation, and
     * activate the fresh Session whose first model-facing context is the
     * Member's own handoff. Later non-Team input captured during the transition
     * is delivered after the handoff; the Team Inbox is rederived from the
     * ledger, never copied.
     */
    private executeMemberTransition;
    /** Ledger handle for log lines; falls back to the raw id when unknown. */
    private memberLabel;
    /**
     * Cache GC: uploads referenced by a Message survive 72h from upload so
     * Member agents keep a consumption window; orphans (never sent) go after
     * 24h. Runs once at startup and then daily — in-process only, because the
     * cache is transient by design and rebuilds nothing across restarts.
     */
    private startAttachmentGc;
    private automaticResumeText;
    private manualResumeText;
    /**
     * Steer one continuation message into a Member's live session. Throws when
     * no handle exists so the coordinator stops tracking; appends the inbox
     * snapshot whenever there is anything new to read.
     */
    private steerResume;
    /** Automatic-recovery wakeup; throwing tells the coordinator the target is gone. */
    private injectRecovery;
    /**
     * Human edit of one Member's mutable facts. A live model selection is
     * updated in place: disposing an Agent emits session/disposed, which makes
     * the Web Client permanently mark the same Session id unavailable even when
     * Team immediately recreates it.
     */
    updateMember(request: AgentTeamUpdateMemberRequest): Promise<AgentTeamMemberResult>;
    /**
     * Live-apply a capability edit at a turn boundary: while the Agent runs, the
     * current turn keeps its schemas and catalog; the swap happens once idle,
     * so the next step recomputes schemas from the new restriction and the
     * durable replacement skill catalog from the new selection, with the same
     * Session and history surviving. Suspend/remove during the wait cancels
     * the swap — the disposed handle released the old restriction already and
     * no disposer leaks.
     */
    private applyCapabilityEdit;
    /** Irreversibly remove one Member, archive its Session, and delete its private namespace. */
    removeMember(request: AgentTeamRemoveMemberRequest): Promise<AgentTeamRemoveMemberResult>;
    /**
     * Archive one Member: commit the archival, stop its live session (disposal
     * only — private memory and the Session log stay on disk for a future
     * restore), and archive the Session from every grouping surface. Like
     * removal, all active Claims release and the Member's Attention clears.
     */
    archiveMember(request: AgentTeamArchiveMemberRequest): Promise<AgentTeamArchiveMemberResult>;
    /** Human-only Task resolution. Business fences are returned as typed outcomes. */
    changeTask(request: AgentTeamTaskRequest): Promise<AgentTeamTaskResult>;
    /** Human-only promotion of a taskless Thread into a real Task plus public Message. */
    promoteThread(request: AgentTeamPromoteThreadRequest): Promise<AgentTeamPromoteThreadResult>;
    /** Human-only Channel membership grant; it never injects historical Thread bodies. */
    joinChannel(request: AgentTeamJoinChannelRequest): Promise<AgentTeamJoinChannelResult>;
    /** Human-only Channel membership removal and Channel-scoped cleanup. */
    removeChannelMember(request: AgentTeamRemoveChannelMemberRequest): Promise<AgentTeamRemoveChannelMemberResult>;
    /** Human-only Workspace participation grant; a pure relation — no Session moves. */
    joinWorkspace(request: AgentTeamJoinWorkspaceRequest): Promise<AgentTeamJoinWorkspaceResult>;
    /** Human-only Workspace participation withdrawal and Workspace-scoped cleanup. */
    leaveWorkspace(request: AgentTeamLeaveWorkspaceRequest): Promise<AgentTeamLeaveWorkspaceResult>;
    /** Human top-level Thread start; asTask attaches an optional Task overlay. */
    sendMessage(request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult>;
    /**
     * Resolve uploaded ids and agent-supplied absolute paths into one attachment
     * metadata list. Paths are all validated before anything is copied, so one
     * rejection leaves the cache untouched and the message uncommitted.
     */
    private resolveMessageAttachments;
    /** Verify requested attachment ids against the cache. */
    private prepareAttachments;
    /**
     * Derive the stored body: one machine-facing `[attachment] <absolute path>`
     * line per attachment appended to the member-facing text.
     */
    private appendAttachmentLines;
    /** Upload one composer attachment into the cache; bytes are immutable once written. */
    putAttachment(request: AgentTeamPutAttachmentRequest): Promise<AgentTeamPutAttachmentResult>;
    /** Read one cached attachment back for client display; gone entries throw and the UI degrades to a chip. */
    getAttachment(request: AgentTeamGetAttachmentRequest): Promise<AgentTeamGetAttachmentResult>;
    /**
     * Human profile read for the settings page and footnote: name + avatar
     * reference from this Host row's live Config plus version facts. Human-scoped
     * (the Web Client calls it); agent tools never receive avatar bytes, only the
     * name through team_view. The new-release check stays best-effort and cached —
     * `updateAvailable` is false until a background refresh actually observes a
     * newer published release.
     */
    humanProfileForClient(_request: AgentTeamHumanProfileRequest): AgentTeamHumanProfileResult;
    /**
     * Upload one human avatar image into the persistent store. Human-only by
     * construction: only the Web Client calls this Remote, never agent tools.
     * The caller stores the returned ref in settings; bytes never enter the
     * TTL-bound attachment cache.
     */
    putHumanAvatar(request: AgentTeamPutHumanAvatarRequest): Promise<AgentTeamPutHumanAvatarResult>;
    /** Read one human avatar back; removed entries throw and the UI falls back to hue/initial. */
    getHumanAvatar(request: AgentTeamGetHumanAvatarRequest): Promise<AgentTeamGetHumanAvatarResult>;
    /** Remove one human avatar entry; the UI falls back to hue/initial afterwards. */
    removeHumanAvatar(request: AgentTeamRemoveHumanAvatarRequest): Promise<AgentTeamRemoveHumanAvatarResult>;
    /**
     * Overwrite the Human profile fields the caller supplies. The Host owns this
     * write because the profile is the Host row's own Config: the schema supplies
     * the shape, this method supplies the two judgements the schema cannot make
     * (a non-empty name, a name no live Member already answers to), and the
     * settings service persists the result into the active profile's patch
     * document and applies it to the running plugin live.
     *
     * No expected revision accompanies the write: the profile is two scalar
     * fields written from the Human's own pages, where the last write wins. This
     * is not a hard boundary around a user-editable document — the settings
     * service's own document opener (and a text editor) can change the stored
     * name without passing here, exactly as the retired section validator could
     * not stop it.
     */
    setHumanProfile(request: AgentTeamSetHumanProfileRequest): Promise<AgentTeamSetHumanProfileResult>;
    /** Human existing-Thread reply; unread and revision conflicts are business outcomes. */
    reply(request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult>;
    /** Human's personal Attention operation. */
    changeAttention(request: AgentTeamThreadAttentionRequest): Promise<AgentTeamThreadAttentionResult>;
    /** Human Inbox projection; the Web Client consumes the direct-only slice as its mention queue. */
    inbox(request: AgentTeamInboxRequest): AgentTeamInbox;
    /** Human's durable, atomically acknowledged Thread read. */
    readThread(request: AgentTeamThreadReadRequest): Promise<AgentTeamThreadReadResult>;
    /** Human-only durable Attention observations for one Thread. */
    threadObservations(request: AgentTeamThreadObservationsRequest): AgentTeamThreadObservations;
    /** Human's non-mutating bounded Thread history. */
    threadHistory(request: AgentTeamThreadHistoryRequest): AgentTeamThreadHistory;
    /** Return the existing bounded public Workspace discovery projection. */
    view(request: AgentTeamViewRequest): AgentTeamView;
    /** Agent-only top-level Thread start. Workspace identity is verified against the live binding. */
    sendMessageForAgent(agent: Agent, request: AgentTeamSendMessageRequest): Promise<AgentTeamSendMessageResult>;
    /** Agent-only existing-Thread reply. */
    replyForAgent(agent: Agent, request: AgentTeamReplyRequest): Promise<AgentTeamReplyResult>;
    /** Agent-only personal Attention change. */
    changeAttentionForAgent(agent: Agent, request: AgentTeamThreadAttentionRequest): Promise<AgentTeamThreadAttentionResult>;
    attentionStatusForAgent(agent: Agent, request: {
        workspaceId: AgentTeamViewRequest['workspaceId'];
        threadRef?: AgentTeamThreadAttentionRequest['threadRef'] | undefined;
        taskRef?: AgentTeamTask['taskRef'] | undefined;
    }): AgentTeamThreadAttentionStatus;
    /** Agent-only Claim mutation. */
    changeClaimForAgent(agent: Agent, request: AgentTeamClaimRequest): Promise<AgentTeamClaimResult>;
    listClaimsForAgent(agent: Agent, request: {
        workspaceId: AgentTeamViewRequest['workspaceId'];
        taskRef: AgentTeamTask['taskRef'];
    }): AgentTeamClaimList;
    inboxForAgent(agent: Agent, request: {
        readonly workspaceId?: WorkspaceId;
        readonly limit?: number;
    }): AgentTeamInbox;
    readThreadForAgent(agent: Agent, request: AgentTeamThreadReadRequest): Promise<AgentTeamThreadReadResult>;
    /**
     * Context advice for one acceptance acknowledged by this read: only when
     * the read carried an unread accept activity AND the Task is still done.
     * Repeat reads (nothing unread), history-style reads, and reopened Tasks
     * carry no advice — the acceptance no longer stands.
     */
    private acceptanceContextAdvice;
    /** Price the reading Member's context against its current route's budgets. */
    private contextAdviceFor;
    private unavailableAdvice;
    /**
     * Agent-only direct message: append the audit-only dm-sent operation, then
     * inject the body into the recipient's live session. The ledger commit is
     * the durable fact; the injection is a transient runtime effect, so a
     * missing handle or a failed wake returns a structured delivery error while
     * the recorded DM stays durable for the recipient's recovery path.
     */
    dmForAgent(agent: Agent, request: AgentTeamDmRequest): Promise<AgentTeamDmResult>;
    /** Relay body: the DM itself plus one bounded line of adjacent context. */
    private dmRelayText;
    threadHistoryForAgent(agent: Agent, request: AgentTeamThreadHistoryRequest): AgentTeamThreadHistory;
    /** Live participation addresses; paths remain owned by the Harness registry. */
    workspacesForAgent(agent: Agent): readonly {
        readonly workspaceId: WorkspaceId;
        readonly path: string | undefined;
        readonly default: boolean;
    }[];
    /** Agent-only bounded discovery projection; participation list carries registry titles when known. */
    viewForAgent(agent: Agent, request: AgentTeamViewRequest): AgentTeamView;
    /** Validate the durable ledger against an independently replayed projection. */
    validateLedger(): void;
    /**
     * Validate the durable ledger for the invariant's mount check. The
     * constructor already re-derived every durable record against its own
     * scratch projection, so this adopts that conclusion once while nothing has
     * committed since; every other call, and every commit-driven validation,
     * replays the whole table again.
     */
    validateLedgerAtMount(): void;
    /**
     * Effective context-pressure budget for one Member's current route:
     * `hardLimit = min(256K, routeWindow - outputReserve)` and
     * `handoffAt = min(200K, hardLimit - handoffReserve)`.
     */
    private contextLimits;
    /**
     * Budget + measurement for one Member's CURRENT routed selection — the
     * member-pinned model or the default selection, resolved through the LLM
     * service so a route change is honored at the next pre-step. The last
     * persisted `request/context` event wins when it matches the current
     * selection (no directory round-trip for an unchanged route). A selection
     * whose capacity cannot be resolved returns `undefined` and the pressure
     * policy fails closed instead of assuming an unbounded route.
     */
    private routeLimitsForAgent;
    /** Cache of resolved context windows per provider/model; unknown stays unknown. */
    private readonly routeWindows;
    /**
     * Resolve one selection's provider-owned context capacity, cached per
     * route. The LLM service is resolved lazily (not a hard inject): the Host
     * mounts it in every production shape, while ledger-level fixtures provide
     * only the services the Team service itself owns. A missing or throwing
     * resolution is an unknown route — the pressure policy fails closed on it.
     */
    private resolvedContextWindow;
    /**
     * Resolve one checkpoint ref to its exact seed prefix before any rollover
     * commit. The walk covers the current generation (own events) and archived
     * ancestors through `sessionPersistence`; the same projection definition
     * folds every source. Guards fail closed: unresolved, foreign-lineage,
     * open-turn, or nonshrinking targets reject without any lifecycle effect.
     */
    private resolveCheckpointSeed;
    /**
     * Rebuild the handoff for a Member whose rollover committed but whose new
     * Session activated without the handoff delivery (a crash between the
     * ledger commit and the swap's delivery step). The previous Session —
     * recorded in the operation, mirrored by the lineage parent, and available
     * from the ledger even when the new Session's own header never carried it —
     * holds the durable intent; fold it cold and deliver the same handoff
     * envelope first. Idempotent: once any handoff exists in the new Session's
     * own log this never runs.
     */
    private reconstructMissingHandoff;
    /**
     * Resolve the exact recorded seed prefix of one committed checkpoint
     * return for crash recovery: cold-read the recorded source Session, take
     * the contiguous prefix of the recorded exclusive length, and verify the
     * source's own fold still resolves the recorded anchor there — an explicit
     * checkpoint through `checkpointByRef`, or a default Team boundary whose
     * recorded ref appears among the source's own boundary keys.
     * Fail-closed by contract: an unreadable source or an unprovable anchor
     * REJECTS the activation — a committed checkpoint return may never
     * downgrade to a blank child.
     */
    private recordedCheckpointPrefix;
    /**
     * Redeliver the old generation's unconsumed post-intent input to a
     * generation whose durable rollover committed but whose delivery did not
     * finish. Bound to the ledger's recorded transition target — the CURRENT
     * Session being that target — never to whether the handoff itself landed,
     * so a crash after the handoff but before the carried enqueue still
     * replays. The fold is the same durable truth the live transition uses
     * (unconsumed, non-Team, order preserved). Idempotency keys on what is
     * CURRENTLY present: delivered `user/message` ids plus the live inbox's
     * pending next-step/next-turn ids — a historical insert that was already
     * claimed (and removed) but never surfaced is NOT known and must replay.
     * Fail-closed for genuinely unreadable previous Sessions (missing/IO) so
     * the Member's input is never dropped silently, with three bounded
     * exceptions: a generation that already started its own turns needs no
     * replay (its carried input was delivered or superseded while it ran), a
     * log-corruption class error skips with a warning (the Host repairs torn
     * tails; a retired generation's corrupt log must not permanently block the
     * Member's activation), and a deterministic released-format refusal skips
     * with a warning (the candidate's own migration audit refuses that
     * artifact, so no retry can ever read it).
     */
    private replayCarriedInput;
    /**
     * Agent-only checkpoint request validation: the tool calls this inside its
     * own running turn. Like `context_rollover`, the tool performs no side effect —
     * the durable checkpoint is the successful `tool/call`+`tool/result` pair
     * the Session projection folds; the ref returned here is deterministic
     * from this Member Session's identity plus the tool call id, so the model
     * can cite it before the result exists and a repeated provider call id in
     * another generation never collides with this one.
     */
    recordCheckpointForAgent(agent: Agent, request: AgentTeamCheckpointToolRequest): AgentTeamCheckpointToolOutcome;
    /**
     * Agent-only bounded structural timeline: resolved checkpoints plus Team
     * delivery, handoff, and compaction boundaries across the current
     * generation and its archived ancestor lineage. Structural only — no
     * transcript content. The walk, the per-source folds, the pricing, and the
     * anchor rules are the engine's `readContextTimeline`; Team contributes the
     * fold configuration, the measurement, and the one judgement the engine
     * leaves to its host — which Threads a boundary's retained prefix holds — so
     * a ref this list offers is a ref `context_rollover` accepts.
     */
    contextTimelineForAgent(agent: Agent, request: AgentTeamTimelineToolRequest): Promise<AgentTeamTimelineToolResult>;
    /**
     * Map one engine timeline item onto the model-facing Team item. The engine
     * decided the walk, the fold, the pricing, and the head, checkpoint, and
     * measurable-source verdicts; Team restates exactly one policy of its own: a
     * Team boundary is selectable only when the RETAINED PREFIX through it stays
     * inside one Thread — the same proof the seed guard revalidates before it
     * swaps a generation. The engine judges a boundary by its OWN attribution
     * instead, so a boundary that arrived after a second Thread's facts would be
     * offered here and refused by `context_rollover`; Team's stricter rule is
     * what keeps the two surfaces answering one question.
     */
    private teamTimelineItemFor;
    /**
     * Replayed measurement of one lineage source: the live current Session
     * measures directly; an archived ancestor measures through a detached
     * Session rebuilt from the source's own log, so a seed's retained cost is
     * priced in the SOURCE's own tokens — never the current generation's.
     * Returns undefined when no meter is available or the source cannot be
     * replayed; callers fail closed on the unknown.
     */
    private sourceUsageTokens;
    /**
     * One already-read source's replayed measurement: an archived generation is
     * rebuilt as a detached Session and measured in its own tokens. Undefined
     * means unmeasurable, never free.
     */
    private measureDetachedSource;
    /**
     * One source's replayed measurement, in that source's own tokens, for a
     * caller that already holds the source: the live generation measures
     * directly, an archived one is rebuilt from the log it came with. Undefined
     * means unmeasurable — a caller must never price an unknown source as free.
     */
    measureContextSourceForAgent(agent: Agent, source: ContextTimelineSource): number | undefined;
    /**
     * The one fold configuration the registered projection unit and every cold
     * fold use, so a generation read back for the timeline reads exactly as the
     * projection folded it — same codec, same boundary attribution.
     */
    contextFoldConfig(): ContextProjectionConfig;
    /**
     * Monotonic anchor-share estimate of a seed's retained cost, priced in the
     * SOURCE Session's own measurement: the fraction of the source log the
     * seed prefix covers, scaled to the source's replayed token count. The
     * anchor position is exact and the share grows monotonically toward the
     * source's head (100%). A large ancestor's anchor therefore prices at the
     * ancestor's real size even inside a small current generation — the
     * timeline display and the return guard share this one estimate.
     */
    private retainedEstimate;
    /**
     * Agent-only rollover request validation: the tool calls this to check its
     * Member binding, exclusivity, and checkpoint ownership. It performs no
     * lifecycle effect — the actual transition reacts to the successful tool
     * result through the context-management coordinator.
     */
    requestNewContext(agent: Agent, request: AgentTeamNewContextToolRequest): Promise<AgentTeamNewContextToolOutcome>;
    /**
     * Jobs this Agent owns that cannot survive a generation swap: any
     * running/stopping job, and any settled job whose terminal output was
     * never reported (disposal would silently discard it). In-place hard
     * compaction is exempt — it never cancels the owner.
     */
    private ownedJobsBlockingRollover;
    /**
     * Agent-only session rollover commit: the Member actor must be the target
     * Member on its currently bound live Session. The Host performs the actual
     * generation swap around this write; the ledger records only the durable
     * binding transition and rollover audit envelope.
     */
    rolloverSessionForAgent(agent: Agent, request: AgentTeamRolloverSessionRequest): Promise<AgentTeamDurableMemberResult>;
    private emitCommittedOutcome;
    private assertChannelMembersAvailable;
    /** Shared Task-creation commit: resolve uploads into metadata lines and append through the ledger. */
    private sendMessageAs;
    /** Shared existing-Thread reply commit: same upload resolution and outcome emission. */
    private replyAs;
    /** Fence one Human Remote call: accepting Host, known Workspace, Human actor. */
    private humanCall;
    /** Fence one Member call: accepting Host, live Member binding, matching Workspace participation. */
    private memberCall;
    private memberActor;
    private requireAgentWorkspace;
    /**
     * Validate a pinned model route's reasoning effort against the adapter's own
     * metadata when the LLM service is reachable; unknown routes defer to the
     * LLM layer's runtime check at call time.
     */
    private assertModelRoute;
    /**
     * Session headers currently durable in the persistence backend.
     *
     * The Host retires a disposed Session's log without awaiting it, so a
     * concurrent activation can observe the JSONL backend's transient win32
     * staging directories (.dsh-mkdir-*) as ENOENT while they rename into
     * place. The read is idempotent; back off briefly instead of failing the
     * activation on a race the publisher resolves within milliseconds.
     */
    private persistedSessionHeaders;
    private activateMember;
    /**
     * Rebuild one enabled Member in place from its persisted Session.
     *
     * A bundle-row reload tears down the preset roster subtree, which prunes the
     * standing mount while live agents keep their dead scope bindings: the
     * Member keeps its session but loses its composed tools and services.
     * Re-running the preset composition requires a fresh Agent, and disposal is
     * the cost — the Web Client marks the recreated Session unavailable until it
     * is reopened, the same trade the shipped suspend/resume cycle makes.
     */
    private reactivateMember;
    /**
     * Default an untitled Member Session to its handle so the ordinary Session
     * list names it. An explicit rename or any earlier title always wins; the
     * cosmetic default never fails Member activation.
     */
    private nameMemberSession;
    private validateMemberPreset;
    private memberStatus;
    private setMemberFailure;
    /** Store one structured activation diagnostic; runtime/compaction slots stay plain messages. */
    private setActivationDiagnostic;
    /**
     * Route one activation failure to its diagnostic class: preset composition
     * failures by their own error class, session failures by the seam's typed
     * classification (our call sites carry it directly; a Harness resume
     * failure carries it through the cause chain), everything else as an
     * unclassified activation failure.
     */
    private activationDiagnosticOf;
    private clearMemberFailure;
    private requireWorkspace;
    private requireLedger;
    private requireAccepting;
    private emitCommitted;
    /** Model-visible active-Claim labels for the pressure notice. */
    private activeClaimLabels;
    /** Model-visible running/stopping job labels for the pressure notice. */
    private runningJobLabels;
    private emitAutoCompactionChanged;
    /**
     * Presence-only invalidation: Agent running/idle/activation/failure changes
     * alter no durable projection, so only members/presence subscribers wake —
     * the workspace catalog and the scope-less Inbox subscriptions stay parked.
     */
    private emitPresenceChanged;
    /** Presence invalidation in every Workspace the Member participates in — each panel listing it must refresh. */
    private emitMemberPresenceChanged;
    /** Wake from durable unread state with bounded facts for direct and state-changing work. */
    private notifyMember;
    private isInboxNotice;
    private isRecoveryNotice;
    private notificationText;
    private boundedNotificationBody;
    private activityNotification;
    /** Dispose one live Member Session and drop its per-Member runtime state. */
    private disposeMemberSession;
    private clearMemberRecoveryState;
    private clearMemberNotificationState;
    /**
     * Wake waiters for one committed or lifecycle change. Undefined broadcasts
     * to everyone; an empty scope list invalidates nobody because no shared
     * projection changed; otherwise global and matching scoped waiters wake.
     * Presence-only scopes sit outside that: they change no durable projection,
     * so only matching presence waiters wake and the scope-less Inbox
     * subscriptions stay parked.
     *
     * Each woken waiter receives the version of its own scope's domain, so a
     * wake can never hand a projection waiter a presence number or the other way
     * around. Nothing here advances the projection version.
     */
    private emitChanged;
    /**
     * The cursor domain of one scope: presence scopes count process-local edge
     * wakes, every other scope compares against the durable ledger position of
     * the newest shared-projection commit. The two domains are deliberately
     * separate, so a presence edge cannot invalidate a projection subscriber and
     * a private read invalidates no one.
     */
    private changeVersionOf;
    private validateChangeScope;
    private enqueueLifecycle;
}
//# sourceMappingURL=index.d.ts.map