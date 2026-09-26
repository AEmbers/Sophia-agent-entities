/**
 * Sophia approval conversation card: the in-conversation approver card shown
 * while a proposed team is still awaiting approval (state pending_owner /
 * pending_captain / draft). Unlike the AgentTeams card — which gates on a
 * successful materialization — the approval card renders BEFORE the team is
 * built, so the owner or captain can pick the team mode and approve or reject.
 *
 * The fold anchors to the Harness's durable `tool/call` + `tool/result`
 * records for `sophia_team_propose`. Those are first-party session events, so
 * the card survives restarts without writing an out-of-repo event type. The
 * structured tool value is execution-local (deliberately omitted from durable
 * events), so the request id / state / requester are recovered from the
 * rendered result text produced by the orchestration propose tool.
 * @module dsh-sophia-entities/client/sophia-approval-card
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TeamMode } from 'dsh-sophia-entities/orchestration/types';
/** It is pending_owner / pending_captain / draft while awaiting approval. */
export type SophiaApprovalPendingState = 'pending_owner' | 'pending_captain' | 'draft';
/** Final keyed Chat payload for the approval card. */
export interface SophiaApprovalCardData {
    readonly requestId: string;
    readonly goal: string;
    /** `isHuman` is true for a human owner proposal; a member initiator carries a handle. */
    readonly requester: {
        readonly isHuman: boolean;
        readonly handle?: string;
    };
    readonly mode: TeamMode | undefined;
    readonly state: string;
    readonly members: readonly {
        readonly name: string;
        readonly role: string;
    }[];
    readonly taskCount: number;
    readonly dependencyCount: number;
}
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
    interface ChatNodeDataMap {
        /** Approval card anchoring a pending team proposal in the conversation. */
        'sophia-approval': SophiaApprovalCardData;
    }
}
/** Folded proposal record (the node's business state). */
export interface SophiaApprovalNodeState {
    readonly requestId: string;
    readonly goal: string;
    readonly requester: {
        readonly isHuman: boolean;
        readonly handle?: string;
    };
    readonly mode: TeamMode | undefined;
    readonly state: string;
    readonly members: readonly {
        readonly name: string;
        readonly role: string;
    }[];
    readonly taskCount: number;
    readonly dependencyCount: number;
}
/**
 * Parse the proposal-call fields the pending card owns: goal, team mode, and
 * the plan's member roster / task / dependency counts. The request id and
 * approval state are only produced by the execution result, so they are read
 * later in the update fold.
 */
export declare function parseSophiaProposeArgs(value: string): {
    goal: string;
    mode: TeamMode | undefined;
    members: readonly {
        name: string;
        role: string;
    }[];
    taskCount: number;
    dependencyCount: number;
} | undefined;
/**
 * Recover the request id / state / requester from the rendered proposal text.
 * The orchestration propose tool renders:
 *   `Proposal filed as request <id> (state <state>, requester <r>[, mode <m>]): "<goal>".`
 *   or the duplicate variant. `requester` is the string `human` for a human
 *   owner, otherwise the member's handle (or member id).
 */
export declare function parseSophiaProposeResult(text: string): {
    requestId: string;
    state: string;
    requester: {
        isHuman: boolean;
        handle?: string;
    };
    mode: TeamMode | undefined;
    isDuplicate: boolean;
} | undefined;
/** Durable first-party tool events folded into one keyed Chat node. */
export declare const sophiaApprovalCardDefinition: ConversationNodeDefinition<SophiaApprovalNodeState>;
/** V4 tool-role results carry isError directly; older logs nest tool-result blocks. */
export declare function toolResultFailed(message: {
    readonly content: readonly unknown[];
    readonly isError?: boolean;
}): boolean;
//# sourceMappingURL=sophia-approval-card-definition.d.ts.map