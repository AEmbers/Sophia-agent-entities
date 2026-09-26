import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import type { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session';
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace';
import type { AgentTeamAddMemberRequest, AgentTeamAttachmentId, AgentTeamAgentMember, AgentTeamArchiveChannelRequest, AgentTeamArchiveChannelResult, AgentTeamArchiveMemberRequest, AgentTeamArchiveMemberResult, AgentTeamChangeScope, AgentTeamContextCheckpointRef, AgentTeamClaim, AgentTeamClaimList, AgentTeamClaimRequest, AgentTeamClaimResult, AgentTeamClaimRef, AgentTeamCreateChannelRequest, AgentTeamCreateChannelResult, AgentTeamDmRequest, AgentTeamDmResult, AgentTeamHumanActor, AgentTeamInbox, AgentTeamInboxRequest, AgentTeamInboxItem, AgentTeamJoinChannelRequest, AgentTeamJoinChannelResult, AgentTeamMemberActor, AgentTeamMemberId, AgentTeamOperation, AgentTeamOperationId, AgentTeamOperationReceipt, AgentTeamRemoveChannelMemberRequest, AgentTeamRemoveChannelMemberResult, AgentTeamJoinWorkspaceRequest, AgentTeamJoinWorkspaceResult, AgentTeamLeaveWorkspaceRequest, AgentTeamLeaveWorkspaceResult, AgentTeamRemoveMemberRequest, AgentTeamRemoveMemberResult, AgentTeamReplyRequest, AgentTeamReplyResult, AgentTeamRequestId, AgentTeamResolvedTaskRef, AgentTeamResolvedThreadRef, AgentTeamMessageAttachment, AgentTeamSendMessageRequest, AgentTeamSendMessageResult, AgentTeamSetMemberStateRequest, AgentTeamStatus, AgentTeamTask, AgentTeamTaskRequest, AgentTeamTaskResult, AgentTeamTaskRef, AgentTeamThreadAttentionRequest, AgentTeamThreadAttentionResult, AgentTeamThreadAttentionStatus, AgentTeamThreadHistory, AgentTeamThreadHistoryRequest, AgentTeamThreadReadFact, AgentTeamThreadReadData, AgentTeamThreadReadRequest, AgentTeamThreadReadResult, AgentTeamThreadReadSnapshot, AgentTeamThreadObservations, AgentTeamThreadObservationsRequest, AgentTeamThreadRef, AgentTeamPromoteThreadRequest, AgentTeamPromoteThreadResult, AgentTeamUpdateChannelRequest, AgentTeamUpdateChannelResult, AgentTeamUpdateMemberRequest, AgentTeamView, AgentTeamViewRequest } from './types.ts';
/** Stable Human Member identity shared by every replay of one dshHome Team. */
export declare const AGENT_TEAM_HUMAN_MEMBER_ID: AgentTeamMemberId;
/**
 * The handle the Human is addressed by in Message bodies. The body parser and
 * the Member directory both read this one constant, so a configurable display
 * name has a single place to land instead of a hard-coded literal per surface.
 */
export declare const AGENT_TEAM_HUMAN_HANDLE = "human";
/** Idempotency identity of the one Host bootstrap operation. */
export declare const AGENT_TEAM_INITIALIZE_REQUEST_ID: AgentTeamRequestId;
/** Resolve the one Human authority owned by this Team. */
export declare function agentTeamHumanActor(): AgentTeamHumanActor;
/** Caller-owned payload of the idempotent Team initialization request. */
export interface AgentTeamInitializeRequest {
    readonly requestId: AgentTeamRequestId;
    readonly actor: AgentTeamHumanActor;
    readonly humanMemberId: AgentTeamMemberId;
}
export interface AgentTeamAuthorizedCreateChannelRequest extends AgentTeamCreateChannelRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedAddMemberRequest extends AgentTeamAddMemberRequest {
    readonly actor: AgentTeamHumanActor;
    readonly member: AgentTeamAgentMember;
}
export interface AgentTeamAuthorizedSetMemberStateRequest extends AgentTeamSetMemberStateRequest {
    readonly actor: AgentTeamHumanActor;
}
/** Host-authorized intent to move one enabled Member onto a fresh Session id. */
export interface AgentTeamAuthorizedRenewMemberSessionRequest {
    readonly requestId: AgentTeamRequestId;
    readonly workspaceId: WorkspaceId;
    readonly memberId: AgentTeamMemberId;
    /** The freshly minted Session the Member transitions onto. */
    readonly sessionId: SessionId;
    readonly actor: AgentTeamHumanActor;
}
/**
 * Member-authored intent to continue in its next private context generation.
 * The requestId and new Session id derive stably from the successful
 * `context_rollover` tool call so crash replay converges on one operation.
 */
export interface AgentTeamAuthorizedRolloverMemberSessionRequest {
    readonly requestId: AgentTeamRequestId;
    readonly workspaceId: WorkspaceId;
    readonly memberId: AgentTeamMemberId;
    /** The calling Member; must be the target Member itself. */
    readonly actor: AgentTeamMemberActor;
    /** The Session the Member must still be bound to at commit time. */
    readonly previousSessionId: SessionId;
    /** The next generation Session, derived from the successful tool call. */
    readonly newSessionId: SessionId;
    /** Seq of the successful `context_rollover` tool result in the previous Session log. */
    readonly handoffEventSeq: SessionSeq;
    /** Why the rollover happened: the model asked, or honored a pressure notice. */
    readonly trigger: 'model' | 'pressure';
    /** Seed source Session for a checkpoint return; absent on a fresh rollover. */
    readonly sourceSessionId?: SessionId;
    /** Exclusive end of the seeded source prefix (its exact length in the source log). */
    readonly sourceThroughSeq?: SessionLogOffset;
    /** The checkpoint a return was addressed to; absent on a fresh rollover. */
    readonly checkpointRef?: AgentTeamContextCheckpointRef;
}
export interface AgentTeamAuthorizedJoinChannelRequest extends AgentTeamJoinChannelRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedRemoveChannelMemberRequest extends AgentTeamRemoveChannelMemberRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedJoinWorkspaceRequest extends AgentTeamJoinWorkspaceRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedLeaveWorkspaceRequest extends AgentTeamLeaveWorkspaceRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedSendMessageRequest extends AgentTeamSendMessageRequest {
    readonly actor: AgentTeamHumanActor | AgentTeamMemberActor;
    /** Metadata the Host resolved from the attachment cache before the append. */
    readonly resolvedAttachments?: readonly AgentTeamMessageAttachment[] | undefined;
}
export interface AgentTeamAuthorizedReplyRequest extends AgentTeamReplyRequest {
    readonly actor: AgentTeamHumanActor | AgentTeamMemberActor;
    /** Metadata the Host resolved from the attachment cache before the append. */
    readonly resolvedAttachments?: readonly AgentTeamMessageAttachment[] | undefined;
}
export interface AgentTeamAuthorizedClaimRequest extends AgentTeamClaimRequest {
    readonly actor: AgentTeamHumanActor | AgentTeamMemberActor;
}
export interface AgentTeamAuthorizedTaskRequest extends AgentTeamTaskRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedPromoteThreadRequest extends AgentTeamPromoteThreadRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedThreadAttentionRequest extends AgentTeamThreadAttentionRequest {
    readonly actor: AgentTeamHumanActor | AgentTeamMemberActor;
}
export interface AgentTeamAuthorizedThreadReadRequest extends AgentTeamThreadReadRequest {
    readonly actor: AgentTeamHumanActor | AgentTeamMemberActor;
}
export interface AgentTeamAuthorizedRemoveMemberRequest extends AgentTeamRemoveMemberRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedArchiveMemberRequest extends AgentTeamArchiveMemberRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedUpdateChannelRequest extends AgentTeamUpdateChannelRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedArchiveChannelRequest extends AgentTeamArchiveChannelRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedUpdateMemberRequest extends AgentTeamUpdateMemberRequest {
    readonly actor: AgentTeamHumanActor;
}
export interface AgentTeamAuthorizedDmRequest extends AgentTeamDmRequest {
    readonly actor: AgentTeamMemberActor;
}
/** Construction hooks used to make durable operation creation deterministic in tests. */
export interface AgentTeamLedgerOptions {
    readonly operationId?: () => AgentTeamOperationId;
    readonly occurredAt?: () => string;
    readonly ref?: (kind: 'channel' | 'message' | 'task' | 'thread' | 'claim' | 'activity') => string;
}
/** Internal append result indicating whether this call committed a new record. */
export interface AgentTeamLedgerResult<T> {
    readonly value: T;
    readonly committed: boolean;
}
/**
 * Outcome of one Thread read. A read that committed always carries the receipt
 * of the operation it wrote; a read that committed nothing — an already-read
 * Thread — answers with the current picture instead, and only a retry of a
 * read that did commit still carries that original receipt.
 */
export type AgentTeamThreadReadOutcome = {
    readonly value: AgentTeamThreadReadResult & {
        readonly receipt: AgentTeamOperationReceipt;
    };
    readonly committed: true;
} | {
    readonly value: AgentTeamThreadReadResult;
    readonly committed: false;
};
interface AgentTeamDurableMemberResult {
    readonly receipt: AgentTeamOperationReceipt;
    readonly member: AgentTeamAgentMember;
}
export type { AgentTeamDurableMemberResult };
/**
 * Which of the two durable Thread-read forms one record holds. Both schemas are
 * strict and structurally disjoint — only the pre-receipt snapshot carries the
 * Thread picture — so `thread` decides it for every stored record.
 */
export declare function isThreadReadSnapshot(data: AgentTeamThreadReadData): data is AgentTeamThreadReadSnapshot;
/** The Thread and optional Task one read targeted, whichever form the record holds. */
export declare function threadReadTargetOf(data: AgentTeamThreadReadData): {
    readonly threadRef: AgentTeamThreadRef;
    readonly taskRef?: AgentTeamTaskRef | undefined;
};
/** Replay and append logic behind the Agent Team service interface. */
export declare class AgentTeamLedger {
    private readonly table;
    /** Live projection; record validation replays build independent Projection values instead. */
    private readonly state;
    private readonly confirmations;
    private readonly createOperationId;
    private readonly createOccurredAt;
    private readonly createRef;
    private operationTail;
    /**
     * Runtime human display name. Durable identity stays `member:human`; only
     * the handle read by @ matching and handle-uniqueness follows this value.
     * The Host syncs it from the `agent-team-human` settings namespace; the
     * ledger never persists it, so a rename affects only later resolutions.
     */
    private humanHandle;
    /**
     * Head of the durable records the constructor's record-level replay
     * validated, adoptable once by the invariant mount. See `validateAtMount`.
     */
    private bootValidation;
    /**
     * Sequence of the newest committed record that invalidated the shared
     * projection — the durable position the Client's change cursors compare
     * against, rebuilt by replay like every other index.
     *
     * Records whose commit is private read progress or audit-only
     * (`changeScopesOf` derives no scope for them) never move it, so one
     * Member's Thread read cannot make a parked Client believe that something it
     * watches changed. Being a ledger position rather than a process counter, it
     * also stays monotone across a restart.
     */
    private projectionVersion;
    constructor(table: KvTable<AgentTeamOperationId, AgentTeamOperation>, options?: AgentTeamLedgerOptions);
    /** Current human display name for @ matching and uniqueness checks. */
    humanDisplayHandle(): string;
    /**
     * Sync the runtime human display name from Host settings. Never persisted:
     * a rename affects only later @ resolutions and handle checks.
     */
    setHumanDisplayHandle(handle: string): void;
    initialize(request?: AgentTeamInitializeRequest): Promise<AgentTeamLedgerResult<AgentTeamOperationReceipt>>;
    createChannel(request: AgentTeamAuthorizedCreateChannelRequest): Promise<AgentTeamLedgerResult<AgentTeamCreateChannelResult>>;
    /** Human rename of one Channel's display facts; identity refs are immutable. */
    updateChannel(request: AgentTeamAuthorizedUpdateChannelRequest): Promise<AgentTeamLedgerResult<AgentTeamUpdateChannelResult>>;
    addMember(request: AgentTeamAuthorizedAddMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>>;
    /** Human edit of one Member's mutable facts; identity, preset, and lifecycle state are preserved. */
    updateMember(request: AgentTeamAuthorizedUpdateMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>>;
    suspendMember(request: AgentTeamAuthorizedSetMemberStateRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>>;
    resumeMember(request: AgentTeamAuthorizedSetMemberStateRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>>;
    /**
     * Move one enabled Member onto a fresh Session: the durable operation
     * records the sessionId transition while identity, memory, and binding
     * survive. The Host disposes the old handle and archives the previous
     * Session log around this write, so the next turn starts empty.
     */
    renewMemberSession(request: AgentTeamAuthorizedRenewMemberSessionRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>>;
    /**
     * Move one enabled Member onto its next context generation as itself. The
     * actor is the calling Member — the Host executes the transition but is
     * never the business actor — and the durable data records only the
     * verifiable envelope (previous/new Session anchors, the successful handoff
     * tool-result seq, checkpoint seed lineage, trigger). The private handoff
     * prose stays in the Member's own Session log. An exact retry resolves to
     * the recorded outcome; the same requestId with different data collides.
     */
    rolloverMemberSession(request: AgentTeamAuthorizedRolloverMemberSessionRequest): Promise<AgentTeamLedgerResult<AgentTeamDurableMemberResult>>;
    getMember(memberId: AgentTeamMemberId): AgentTeamAgentMember | undefined;
    /**
     * The retired Session this Member most recently left through a renewal or
     * rollover — the lineage parent a crash between the durable binding commit
     * and the new Session's activation must reconstruct a handoff from. Read
     * from the audit projection; the Member record itself only names the
     * current Session.
     */
    previousSessionForMember(memberId: AgentTeamMemberId): SessionId | undefined;
    /**
     * The latest session transition this Member committed: the retired Session
     * and the target it moved onto, through either a renewal or a rollover.
     * Crash recovery binds carried-input redelivery to the recorded target —
     * the CURRENT Session being that target proves the old generation's
     * unconsumed input still belongs here, regardless of whether the handoff
     * itself already landed.
     */
    lastTransitionForMember(memberId: AgentTeamMemberId): {
        readonly previousSessionId: SessionId;
        readonly targetSessionId: SessionId;
    } | undefined;
    /**
     * The Thread a Task overlay lives on, or undefined for an unknown or
     * archived-Channel Task. Read-only input for attributing claim-mutation
     * boundaries to the Thread whose context they entered.
     */
    threadForTask(taskRef: AgentTeamTaskRef): AgentTeamThreadRef | undefined;
    /**
     * The seed envelope of this Member's most recent rollover, when that
     * rollover was a checkpoint return: the recorded source Session, the
     * exclusive end of its seeded prefix, and the checkpoint ref. A fresh
     * rollover clears the envelope. Crash recovery reads this to rebuild the
     * child generation from the recorded seed instead of an empty context.
     */
    rolloverSeedForMember(memberId: AgentTeamMemberId, targetSessionId: SessionId): {
        readonly sourceSessionId: SessionId;
        readonly sourceThroughSeq: SessionLogOffset;
        readonly checkpointRef: AgentTeamContextCheckpointRef;
    } | undefined;
    /**
     * Count one Member's active Claims on open Tasks in active Channels — the
     * read-only input to the checkpoint single-Thread coverage guard: with
     * more than one, a rewind cannot be proven to stay inside one Thread.
     */
    activeClaimCountForMember(memberId: AgentTeamMemberId): number;
    /**
     * One Member's active Claims on open Tasks in active Channels, oldest
     * first — the read-only input for the pressure notice's Claim labels.
     */
    activeClaimsForMember(memberId: AgentTeamMemberId): readonly AgentTeamClaim[];
    listMembers(): readonly AgentTeamAgentMember[];
    joinChannel(request: AgentTeamAuthorizedJoinChannelRequest): Promise<AgentTeamLedgerResult<AgentTeamJoinChannelResult>>;
    removeChannelMember(request: AgentTeamAuthorizedRemoveChannelMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamRemoveChannelMemberResult>>;
    /**
     * Join one Agent Member to one additional Workspace. Participation is a
     * pure relation — no Session is created or moved; the Member's Session
     * stays rooted in its default Workspace and collaboration in the joined
     * Workspace is ledger work addressed by the workspaceId.
     */
    joinWorkspace(request: AgentTeamAuthorizedJoinWorkspaceRequest): Promise<AgentTeamLedgerResult<AgentTeamJoinWorkspaceResult>>;
    /**
     * Withdraw one Agent Member from one of its non-default Workspaces. The
     * default Workspace cannot be left — ending it is the archive path. Every
     * active Claim the Member holds on the Workspace's Threads releases with
     * public Activities, its Attention and markers on those Threads clear, and
     * its Channel memberships there end; identity, Session, and remaining
     * participations are untouched.
     */
    leaveWorkspace(request: AgentTeamAuthorizedLeaveWorkspaceRequest): Promise<AgentTeamLedgerResult<AgentTeamLeaveWorkspaceResult>>;
    /**
     * Archive one Channel: hidden from every surface, facts kept recoverable.
     * Every active Claim on the Channel's Threads releases with one public
     * Activity per (owner, Thread), and every Member's Attention and markers
     * for those Threads clear — a hidden Channel must not leave Tasks stuck in
     * progress behind it or phantom unread counts.
     */
    archiveChannel(request: AgentTeamAuthorizedArchiveChannelRequest): Promise<AgentTeamLedgerResult<AgentTeamArchiveChannelResult>>;
    sendMessage(request: AgentTeamAuthorizedSendMessageRequest): Promise<AgentTeamLedgerResult<AgentTeamSendMessageResult>>;
    reply(request: AgentTeamAuthorizedReplyRequest): Promise<AgentTeamLedgerResult<AgentTeamReplyResult>>;
    promoteThread(request: AgentTeamAuthorizedPromoteThreadRequest): Promise<AgentTeamLedgerResult<AgentTeamPromoteThreadResult>>;
    changeClaim(request: AgentTeamAuthorizedClaimRequest): Promise<AgentTeamLedgerResult<AgentTeamClaimResult>>;
    changeTask(request: AgentTeamAuthorizedTaskRequest): Promise<AgentTeamLedgerResult<AgentTeamTaskResult>>;
    removeMember(request: AgentTeamAuthorizedRemoveMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamRemoveMemberResult>>;
    /**
     * Archive one Member: hidden from every surface, data kept recoverable.
     * The release shape matches removal — active Claims release with public
     * Activities and the Member's Attention/markers clear — because a hidden
     * Member must not leave Tasks stuck in progress or phantom unread counts.
     */
    archiveMember(request: AgentTeamAuthorizedArchiveMemberRequest): Promise<AgentTeamLedgerResult<AgentTeamArchiveMemberResult>>;
    changeAttention(request: AgentTeamAuthorizedThreadAttentionRequest): Promise<AgentTeamLedgerResult<AgentTeamThreadAttentionResult>>;
    /**
     * Append one Member-to-Member direct message as an audit-only operation.
     * A DM is pure delivery: no Channel, Thread, revision, attention, or
     * markers change, so apply() is a marker and no projection state moves.
     */
    sendDm(request: AgentTeamAuthorizedDmRequest): Promise<AgentTeamLedgerResult<AgentTeamDmResult>>;
    /**
     * Bounded adjacent context for a DM relay: the truncated body of the most
     * recent earlier DM between the two sessions, newest first. Returns
     * undefined when this is their first exchange. `excluding` skips the
     * operation id of the DM being delivered right now, so the context line is
     * the adjacent prior exchange rather than a self-reference. Direction
     * labels are from the reader's perspective: the reader is the recipient of
     * the DM being delivered, so messages the reader sent are `you → them`.
     */
    dmHistoryBetween(senderSessionId: SessionId, recipientMemberId: AgentTeamMemberId, excluding?: AgentTeamOperationId): string | undefined;
    attentionStatus(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: {
        workspaceId: WorkspaceId;
        threadRef?: AgentTeamThreadRef | undefined;
        taskRef?: AgentTeamTaskRef | undefined;
    }): AgentTeamThreadAttentionStatus;
    inbox(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: AgentTeamInboxRequest): AgentTeamInbox;
    memberInbox(actor: AgentTeamMemberActor, request: {
        readonly limit?: number;
    }): AgentTeamInbox;
    private inboxForWorkspaces;
    /**
     * The one person a row names: whoever committed the fact that row's instant
     * came from — a Message's sender, an activity's actor — resolved to the handle
     * the row draws. Resolving it here is what spares every Client row a Member
     * view of its own, and a Member the roster no longer names still reads as
     * themselves through their raw id rather than as nobody.
     */
    private inboxActorFor;
    /**
     * One Member as a row draws them: the id carries the identity hue, the handle
     * the initial. The Human is the one Member the Agent roster never holds, so
     * their row reads the runtime display name rather than falling back to the
     * durable `member:human` id — the same name every other seat and @ matching
     * already use.
     */
    private memberActor;
    /**
     * The people a Task still has on it, resolved the way a row draws them: owners
     * of its live Claims, in claim order, deduped. A released Claim is not work,
     * and a done or closed Task keeps its Claims as history rather than as
     * presence — deliberately the same rule the Channel feed applies to the same
     * Task, so 「谁在这个 Task 上」 never acquires a second definition.
     */
    private liveClaimOwners;
    /**
     * The Human Inbox's 「最近活跃」 slice: the Threads this reader has written in
     * — the durable way back into work instead of a mention-only queue.
     * Participation is the whole admission rule: a reader who replied to somebody
     * else's Thread is here whether or not they follow it, and so is one who
     * started a Thread nobody has answered yet, because starting one is writing
     * its anchor. Attention deliberately plays no part — it decides what notifies
     * a reader (a reply does not implicitly follow a Thread), and reading it here
     * as well is what once hid every Thread a reader had replied to without
     * following. A Thread the reader later unfollowed stays: they did take part
     * in it, and unfollowing stops the notifications, not the record. Every
     * Thread still holding unread is excluded because the queue above already
     * carries it, and the slice is newest-activity first, bounded by
     * `RECENT_INBOX_LIMIT`. Rows are the same shape as unread rows with every
     * count at zero — they are the same row to render.
     */
    private recentInboxItems;
    /**
     * Threads that can hold unread facts for one reader, from the per-reader
     * derived indexes: Attention follows plus direct and activity markers.
     * Every unread source is covered — ordinary unread requires Attention, and
     * marker unread requires a marker — so no full Thread scan is needed.
     */
    private inboxCandidateThreads;
    /** Model-visible notification material derived from the recipient's current durable unread state. */
    notificationFacts(memberId: AgentTeamMemberId, request?: AgentTeamInboxRequest): readonly {
        readonly item: AgentTeamInboxItem;
        readonly facts: readonly AgentTeamThreadReadFact[];
    }[];
    readThread(request: AgentTeamAuthorizedThreadReadRequest): Promise<AgentTeamThreadReadOutcome>;
    threadObservations(actor: AgentTeamHumanActor, request: AgentTeamThreadObservationsRequest): AgentTeamThreadObservations;
    /** Every operation carrying an inbox delta drives the Inbox projection; the payload shape decides, not a per-kind list. */
    private attentionDelta;
    /** Attachment ids referenced by any stored Message — the GC's keep-set oracle. */
    referencedAttachmentIds(): Set<AgentTeamAttachmentId>;
    threadHistory(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: AgentTeamThreadHistoryRequest): AgentTeamThreadHistory;
    listClaims(actor: AgentTeamHumanActor | AgentTeamMemberActor, request: {
        workspaceId: WorkspaceId;
        taskRef: AgentTeamTaskRef;
    }): AgentTeamClaimList;
    getTask(taskRef: AgentTeamTaskRef): AgentTeamTask | undefined;
    getClaim(claimRef: AgentTeamClaimRef): AgentTeamClaim | undefined;
    /** Navigation facts for message-body Thread refs; unknown refs are omitted. */
    resolveThreadRefs(workspaceId: WorkspaceId, threadRefs: readonly AgentTeamThreadRef[]): AgentTeamResolvedThreadRef[];
    /** Navigation facts for message-body Task refs; unknown refs are omitted. */
    resolveTaskRefs(workspaceId: WorkspaceId, taskRefs: readonly AgentTeamTaskRef[]): AgentTeamResolvedTaskRef[];
    view(request: AgentTeamViewRequest, memberId?: AgentTeamMemberId): AgentTeamView;
    status(): AgentTeamStatus;
    validate(): void;
    /**
     * Validate the durable ledger for the invariant's mount check, reusing the
     * constructor's record-level replay once instead of paying a second identical
     * one at startup.
     *
     * The adoption is gated on the operations table's single-writer identity —
     * this ledger's commit path is the only caller of `table.put` — so an
     * unchanged record count, head sequence and head operation id mean a
     * mount-time replay would re-derive precisely the records the constructor
     * already re-derived against its own scratch projection. Any commit between
     * construction and mount, and every later call, falls back to the full
     * replay. The check is never narrowed: the reused conclusion is still that
     * same independent replay of every durable record.
     */
    validateAtMount(): void;
    hasCommitted(requestId: AgentTeamRequestId): boolean;
    /** Return one stored committed operation by id. */
    getOperation(operationId: AgentTeamOperationId): AgentTeamOperation | undefined;
    /**
     * Claim releases are thread-visible facts: an open Channel page and every
     * affected Thread page must refetch alongside the workspace-wide change. Each
     * released activity contributes its own Thread scope plus the Channel that
     * owns its Task, deduplicated against the caller's initial scopes — which is
     * why the caller passes them in rather than the helper inventing them.
     */
    private withReleasedActivityScopes;
    /** One workspace change scope per Workspace the Member participates in — member-level commits wake every panel that lists it. */
    private memberWorkspaceScopes;
    /**
     * Durable position of the newest shared-projection commit: the version every
     * change waiter outside the presence scope observes. It only moves when a
     * commit has scopes somebody could refetch (`changeScopesOf`), never for
     * private read progress or an audit-only record.
     */
    projectionSequence(): number;
    /** Scopes whose projections one committed operation invalidates; undefined wakes every waiter. */
    changeScopesOf(operation: AgentTeamOperation): readonly AgentTeamChangeScope[] | undefined;
    /** Members whose Inbox projection may have changed; the Host notifies only live ones. */
    affectedMembersOf(operation: AgentTeamOperation): readonly AgentTeamMemberId[];
    private touchedThreadRefs;
    private replay;
    private validateRecords;
    private validateOperation;
    /**
     * Validation of one operation's Inbox delta against the projection it was
     * derived from.
     *
     * Direct marker references resolve through the replay-derived Message index:
     * this runs once per inbox-carrying record, so a rescan of the Message list
     * here would make every record cost the whole ledger. The index is written by
     * the same fact appends that build `factsByThread`, so a lookup sees exactly
     * the records replayed before this one and can never reach a Message that
     * arrives later — which is why the operation's own entity, not yet in the
     * projection, needs the `additional*` fallbacks. The commit path resolved the
     * projection first and then its own record, and that precedence is kept.
     */
    private validateInboxDelta;
    /**
     * Replay validation of one departure's release snapshot against the
     * projection it was derived from. `memberId` scopes everything to a single
     * departing Member; `undefined` validates every owner, which is what
     * archiving a whole Channel releases. The two scopes differ in exactly four
     * ways, all of them visible here rather than spread over two copies:
     *
     * 1. released Claims are owner-filtered for a Member, unfiltered for a Channel;
     * 2. Activities group per (owner, Thread) with owners sorted, which for a
     *    single departing Member collapses to one Activity per Thread — the shape
     *    the commit path writes;
     * 3. the inbox cleanup covers the departing Member's Attention and markers, or
     *    every Member's on the archived Channel's Threads;
     * 4. the failure message names which of the two paths lost its cleanup.
     */
    private validateReleaseCleanup;
    private validateMessageInbox;
    private validateMentions;
    private validMentionTarget;
    private apply;
    private applyTo;
    /**
     * Replay the departure snapshot a releasing operation carries. The order is
     * replay semantics, not style: Claims land before the Activities that
     * reference them, and Tasks/Threads before the inbox delta that reads them.
     * Each caller still applies its own identifying writes (member, membership,
     * channel) around this call.
     */
    private applyReleaseSnapshot;
    /** Facts arrive in ledger sequence order, so global and per-thread lists stay sorted by append only. */
    private appendMessageFact;
    private appendActivityFact;
    /** Display ordinals are a per-Channel creation counter; the workspace filter happens at read time. */
    private recordTaskNumber;
    /**
     * Replay-order Attention observations, appended from committed Inbox deltas
     * only (the hypothetical read projection applies its delta directly). The
     * follow/unfollow decision mirrors the full replay scan it replaces: a
     * removal records only when Attention existed, and a set records unless it
     * is the Thread-creating Message (initial Attention) or merely advances the
     * same follow's watermark. Removals are evaluated before sets, exactly like
     * the scan's loop order.
     */
    private recordAttentionObservations;
    private appendObservation;
    private applyInboxDelta;
    /** Insert into the Member's Thread bucket keeping the sequence order the read path must see. */
    private insertBucketedMarker;
    private removeBucketedMarker;
    private prepareRead;
    /**
     * Derive the durable receipt of one Thread read from a prior projection: the
     * Thread it targeted, the watermark it reaches, the Attention row it writes
     * and the Inbox delta it consumes. This is the whole durable content of a
     * receipt-shaped read and the only thing `validateRecords` re-derives for
     * one; the picture derivation below builds on the same result, so the two can
     * never drift.
     */
    private prepareReadReceiptFrom;
    /** Derive the only legal durable result of one Thread read from a prior projection. */
    private prepareReadFrom;
    private readFactFrom;
    private unreadFor;
    private unreadForFrom;
    /**
     * The single authority on "this fact is unread for this reader". The picture
     * derivation and the remaining-count derivation both go through it, so the
     * count a read reports can never disagree with the facts it lists. Marker
     * membership arrives as key sets: the caller may be looking at a state the
     * projection has not applied yet.
     */
    private isUnreadFact;
    /**
     * Unread count once this read's own Inbox delta has been applied, derived
     * without materializing a hypothetical projection. The delta can only touch
     * the reader's own Attention row and its own marker keys in one Thread, and
     * every lookup in `isUnreadFact` is scoped to that same (member, Thread)
     * pair, so the post-delta state is the Attention row the receipt already
     * derived plus those marker keys with the delta's own removals and additions
     * applied.
     */
    private remainingUnreadAfter;
    private visibleToFollower;
    private threadFacts;
    private threadFactsFrom;
    /**
     * The one per-fact instant projection: a fact's wall-clock time is the
     * occurredAt of the ledger operation that committed it, looked up by
     * sequence inside the same read snapshot. Every agent-facing surface
     * (Thread facts, notifications, DM history, mutation results) resolves
     * through this single path, never a second parallel lookup.
     */
    private occurredAtForFactFrom;
    private messageInboxDelta;
    private closeThreadInbox;
    private closeThreadInboxFrom;
    /**
     * Acceptance notifies every done Claim owner — pre-finished (the normal
     * flow) and atomically completed (early acceptance) alike — through
     * activity markers regardless of whether they still follow the Thread.
     * The actor never notifies itself. Legacy records without the acceptance
     * discriminator keep the old completed-only wake semantics on replay.
     */
    private acceptThreadInbox;
    private acceptThreadInboxFrom;
    private reopenThreadInbox;
    private reopenThreadInboxFrom;
    /** Promotion wakes every current follower; the Human actor never follows, so no recipient filter is needed. */
    private promoteThreadInbox;
    private promoteThreadInboxFrom;
    private removeMemberThreadInbox;
    private removeMemberThreadInboxFrom;
    /** Attention and marker cleanup for EVERY Member on the given Threads. */
    private channelArchivalInbox;
    private channelArchivalInboxFrom;
    private inboxDelta;
    private startAttention;
    private followAttention;
    private followAttentionFrom;
    private currentTail;
    private attentionFor;
    private attentionForFrom;
    private isFollowing;
    private isFollowingFrom;
    private directMarkersFor;
    private directMarkersForFrom;
    private activityMarkersForFrom;
    private issueConfirmation;
    private consumeConfirmation;
    private assertMentionTargets;
    private unreadRequired;
    private staleRevision;
    private releaseSummaries;
    private threadsForActivities;
    private claimsForTask;
    private claimsForTaskFrom;
    private claimsForVisibleTasks;
    private tasksForClaims;
    /** Resolve one Task's Thread for a workspace-authorized actor; Member actors must belong to the Task's Channel. */
    private threadForActor;
    /** Business outcomes that defer a thread write: unread work first, then a stale revision. */
    private deferredThreadWrite;
    /** Commit projections shared by the Message-sent and Thread-replied results. */
    private committedMessageResult;
    private threadAnchor;
    private threadAnchorFrom;
    private threadFactKey;
    /**
     * Display numbers for Tasks: one counter per home Channel, in creation
     * order. This is the single numbering authority — Channel cards, Thread
     * headings, cross-channel ref resolution, and inbox renders all show the
     * ordinal the Task holds inside its own Channel. The ordinals are derived
     * at replay time (`taskNumberByTask`); this read only filters them to one
     * Workspace.
     */
    private taskNumbers;
    private hasActiveClaim;
    private hasActiveClaimFrom;
    private deriveResolvedTaskStatus;
    private deriveTaskStatus;
    private setMemberState;
    private assertActorForWorkspace;
    private assertHumanActor;
    private assertMemberActor;
    /** Shortest accepted UUID abbreviation after the branded prefix. */
    private static readonly MIN_REF_UUID_PREFIX;
    private isRefAbbreviationTail;
    /**
     * Full map key for one branded ref, tolerating a unique UUID abbreviation.
     * Exact refs win; an abbreviated ref (prefix plus at least 6 hex chars,
     * hyphens ignored) resolves only when it matches exactly one key. Returns
     * undefined for unknown or ambiguous refs so lenient callers can degrade
     * without throwing.
     */
    private uniqueRefKey;
    /** uniqueRefKey with the established unknown/ambiguous error contract and hints. */
    private requireRefKey;
    /** Agents strip the branded prefix or abbreviate UUIDs when echoing refs; point at the fix instead of a bare lookup failure. */
    private unknownRefHint;
    private requireTask;
    private requireThread;
    private channelRefForThread;
    private channelRefForThreadFrom;
    private threadContextForActor;
    private threadContextFrom;
    private requireChannel;
    /** Guard for every mutating or Channel-scoped surface flow: archived Channels reject. */
    private requireActiveChannel;
    /** Thread-mutation guard: the Channel owning the Thread must still be active. */
    private assertThreadChannelActive;
    private requireMember;
    private requireMemberChannel;
    private isChannelMember;
    private isChannelMemberFrom;
    /** Every Thread of the Channel, taskful or taskless — the scope both cleanup validators replay against. */
    private channelThreadRefs;
    private channelThreadRefsFrom;
    /** The Workspace authorization question: does this Member participate in this Workspace. */
    participatesIn(memberId: AgentTeamMemberId, workspaceId: WorkspaceId): boolean;
    private participatesInFrom;
    /** Every Workspace the Member participates in: the default first, then the rest sorted. */
    workspacesOf(memberId: AgentTeamMemberId): readonly WorkspaceId[];
    private workspacesOfFrom;
    /** Whether two Members share at least one Workspace participation — the handle-uniqueness scope. */
    private participationOverlapFrom;
    /** Every Thread in the Workspace — the scope a Workspace leave replays its cleanup against. */
    private workspaceThreadRefs;
    private workspaceThreadRefsFrom;
    private assertJoinableMember;
    private normalizeRecipients;
    private normalizeUnique;
    /**
     * Names a Message body may address in one Channel: every live Member of that
     * Channel plus the Human. A name outside this set stays prose, which is what
     * keeps an incidental name-drop from reaching someone the Channel cannot
     * deliver to.
     *
     * The Human is reachable under two names: the current display handle and the
     * permanent `human` alias, so a rename never silently orphans `@human`
     * (matching ignores case, and chips render the display name either way).
     * The alias yields when another candidate already answers to it, so one
     * written name never notifies two different Members; enrollment reserves the
     * literal, so that yield only ever covers data predating the reservation.
     */
    private mentionCandidatesFor;
    /**
     * Merge the `@Handle` mentions authored in `body` into an explicit recipient
     * set. Body mentions are the primary channel now: an Agent has no recipient
     * parameter to forget, and the same scan serves Human input typed by hand.
     * The result stays a plain recipient set, so every downstream projection —
     * delivery markers, chip rendering, confirmation — is unchanged.
     */
    private mergeBodyMentions;
    /**
     * Whether one Member has ever held Attention on one Thread. Committed Inbox
     * deltas append a follow/unfollow observation, and the live index covers the
     * Thread-creating Message whose initial Attention is never observed — so the
     * two together answer "was this Member ever part of this Thread" without
     * adding a second durable authority.
     */
    private everParticipated;
    private everParticipatedFrom;
    /**
     * Split the Agent recipients an existing Thread cannot deliver to: those the
     * body named that the Thread has never carried. The send still commits — a
     * text mention must never fail the write — and the author is told through the
     * result, because inviting a Member into an existing Thread stays a Human
     * decision.
     */
    private undeliverableRecipients;
    private normalizeDirection;
    private assertHandleAvailable;
    private assertHandleAvailableFrom;
    /** Provider route and model id are exact identifiers; only whitespace-only values are rejected. */
    private assertModelSelection;
    /**
     * Capability allow-list entries are exact identifiers (skill names,
     * reserved tool names); only whitespace-only values are rejected. Unknown
     * names are intent, not errors — committing must stay replayable across
     * Harness upgrades, so divergence is derived at activation instead.
     */
    private assertCapabilities;
    private initialization;
    private assertInitializationRecord;
    private assertSameInitialization;
    private assertSameChannelCreation;
    private assertSameMemberAdd;
    private assertSameMemberState;
    private assertSameMemberSessionRenewed;
    private assertSameMemberSessionRolledOver;
    private assertSameChannelUpdate;
    private assertSameMemberUpdate;
    private assertSameChannelJoin;
    private assertSameChannelMemberRemoval;
    private assertSameWorkspaceJoin;
    private assertSameWorkspaceLeave;
    private assertSameChannelArchival;
    private assertSameDm;
    private dmResult;
    private assertSameMessage;
    private assertSameReply;
    private assertSamePromotion;
    private assertSameClaim;
    private assertSameTask;
    private assertSameRemoval;
    private assertSameArchival;
    private assertSameAttention;
    private assertSameThreadRead;
    private sameTask;
    private sameTaskIdentity;
    private sameClaim;
    private sameClaimIdentity;
    private sameThread;
    private sameMemberIdentity;
    /** sameMemberIdentity minus the sessionId: every durable Member fact a session renewal must carry over unchanged. */
    private sameMemberFacts;
    private sameActor;
    private sameList;
    private attentionKey;
    private directMarkerKey;
    private activityMarkerKey;
    private addMembership;
    private addRef;
    private throwRequestCollision;
    private channelResult;
    private channelUpdateResult;
    private memberResult;
    private joinResult;
    private channelMemberRemovalResult;
    private workspaceJoinResult;
    private workspaceLeaveResult;
    private channelArchivalResult;
    private messageResult;
    private replyResult;
    private claimResult;
    private taskResult;
    private attentionResult;
    private promotionResult;
    /**
     * The Thread picture a read answers with, derived from the projection the
     * read resolved against. Committed reads, no-op reads and retries all share
     * this one derivation, so a read that writes nothing still returns the same
     * Attention, facts, watermark and unread count a committed one would.
     */
    private readPicture;
    private receipt;
    private removalResult;
    private archivalResult;
    private operationBase;
    private nextSequence;
    private ref;
    private committed;
    private resolved;
    private sortedRecords;
    /**
     * Releases up to 0.1.9 scoped Channel archival and Channel member-removal
     * inbox cleanup to taskful Threads only (the collector read the Task
     * projection), so archiving or member removal in a Channel holding a
     * taskless Thread with Attention or markers wrote an incomplete inbox and
     * every later load rejected the record, leaving the profile unable to boot.
     * Records carrying exactly that legacy cleanup are repaired in memory the
     * same way pre-envelope Thread reads are; any other inbox still fails
     * validation, so a forgery is not silently accepted.
     */
    private repairLegacyChannelCleanup;
    /** The pre-fix Channel Thread scope: only Threads carrying a Task. */
    private legacyChannelThreadRefs;
    /**
     * Ledgers written before message occurredAt existed store bare messages;
     * snapshot-shaped Thread reads resolve instants from the originating
     * operations. A receipt-shaped read carries no message at all, so it passes
     * through untouched — the load path must never touch a shape it does not
     * have, and it never writes either form back.
     */
    private normalizeOperation;
    private enqueue;
}
//# sourceMappingURL=ledger.d.ts.map