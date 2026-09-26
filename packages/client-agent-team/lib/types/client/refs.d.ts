import type { SessionId } from '@deepseek-ai/dsh-session';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { AgentTeamChannel, AgentTeamChannelRef, AgentTeamClientMemberStatus, AgentTeamMemberId, AgentTeamResolveTaskRefsRequest, AgentTeamResolveTaskRefsResult, AgentTeamResolveThreadRefsRequest, AgentTeamResolveThreadRefsResult, AgentTeamTaskRef, AgentTeamThreadRef } from 'dsh-sophia-entities/types';
/** Navigation facts for one branded Task ref, resolved once per session. */
export interface ResolvedTaskRef {
    readonly taskRef: AgentTeamTaskRef;
    readonly channelRef: AgentTeamChannelRef;
    readonly threadRef: AgentTeamThreadRef;
    readonly taskNumber: number;
}
/** Navigation facts for one branded Thread ref, resolved once per session. */
export interface ResolvedThreadRef {
    readonly threadRef: AgentTeamThreadRef;
    readonly channelRef: AgentTeamChannelRef;
    readonly taskRef?: AgentTeamTaskRef;
    readonly taskNumber?: number;
    /** Opening-line gist distinguishing one Thread chip from another. */
    readonly title: string;
}
/** One roster-resolved Member behind a `member:` chip. */
export interface ResolvedMemberRef {
    readonly memberId: AgentTeamMemberId;
    /** Bare handle without the `@`; the chip renders it. */
    readonly handle: string;
    /** Present for agent Members; absent for the Human (no session to open). */
    readonly sessionId?: SessionId;
    /** Only active agent Members open a session — mirrors the agent card rule. */
    readonly openable: boolean;
}
/** Compare refs by branded prefix plus hyphen-stripped UUID, so abbreviated spellings line up with their full form. */
export declare function refKeyOf(ref: string): string;
/** React binding: re-renders the caller when any Task ref resolution lands. */
export declare const useResolvedTaskRefVersion: () => number;
export declare const cachedResolvedTaskRef: (ref: AgentTeamTaskRef) => ResolvedTaskRef | undefined;
/** Store one Task resolution (click path) and wake every rendered link. */
export declare const rememberResolvedTaskRef: (entry: ResolvedTaskRef) => void;
export declare const resolveUnknownTaskRefs: (refs: readonly AgentTeamTaskRef[], lookup: (refs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>) => Promise<void>;
/** React binding: re-renders the caller when any Thread ref resolution lands. */
export declare const useResolvedThreadRefVersion: () => number;
export declare const cachedResolvedThreadRef: (ref: AgentTeamThreadRef) => ResolvedThreadRef | undefined;
/** Store one Thread resolution (click path) and wake every rendered link. */
export declare const rememberResolvedThreadRef: (entry: ResolvedThreadRef) => void;
export declare const resolveUnknownThreadRefs: (refs: readonly AgentTeamThreadRef[], lookup: (refs: readonly AgentTeamThreadRef[]) => Promise<readonly ResolvedThreadRef[]>) => Promise<void>;
/**
 * Click-path Task lookup: remember every resolved entry and hand them back
 * for immediate navigation (see hostRefLookup for the ordering contract).
 */
export declare const hostTaskRefLookup: (resolveTaskRefs: (request: AgentTeamResolveTaskRefsRequest) => Promise<RemoteResult<AgentTeamResolveTaskRefsResult>>, workspaceId: AgentTeamResolveTaskRefsRequest["workspaceId"]) => ((taskRefs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>);
/**
 * Click-path Thread lookup: remember every resolved entry and hand them back
 * for immediate navigation (see hostRefLookup for the ordering contract).
 */
export declare const hostThreadRefLookup: (resolveThreadRefs: (request: AgentTeamResolveThreadRefsRequest) => Promise<RemoteResult<AgentTeamResolveThreadRefsResult>>, workspaceId: AgentTeamResolveThreadRefsRequest["workspaceId"]) => ((threadRefs: readonly AgentTeamThreadRef[]) => Promise<readonly ResolvedThreadRef[]>);
/** Resolve one Task ref through the Host and jump to its home Channel Thread. */
export declare const jumpToTaskThread: (resolveTaskRefs: (request: AgentTeamResolveTaskRefsRequest) => Promise<RemoteResult<AgentTeamResolveTaskRefsResult>>, workspaceId: AgentTeamResolveTaskRefsRequest["workspaceId"], taskRef: AgentTeamTaskRef, selectThread: (threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void) => void;
/** Resolve one Thread ref through the Host and jump to its home Channel Thread. */
export declare const jumpToThread: (resolveThreadRefs: (request: AgentTeamResolveThreadRefsRequest) => Promise<RemoteResult<AgentTeamResolveThreadRefsResult>>, workspaceId: AgentTeamResolveThreadRefsRequest["workspaceId"], threadRef: AgentTeamThreadRef, selectThread: (threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void) => void;
/**
 * Display name for one authored channel ref, or undefined when the loaded
 * roster does not know it — the caller keeps plain text. Archived Channels
 * never resolve: they are gone from every Team surface, so their refs are
 * not links either.
 */
export declare const rosterChannelName: (channels: readonly AgentTeamChannel[], channelRef: AgentTeamChannelRef) => string | undefined;
/**
 * Roster facts for one authored member ref, or undefined when nobody on the
 * roster answers to it — the caller keeps plain text. The Human resolves to
 * a handle with no session: informative, never a link.
 */
export declare const rosterMember: (members: readonly AgentTeamClientMemberStatus[], humanMemberId: AgentTeamMemberId | undefined, humanHandle: string, memberRef: AgentTeamMemberId) => ResolvedMemberRef | undefined;
//# sourceMappingURL=refs.d.ts.map