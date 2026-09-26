/**
 * Approval notifications (design §4.6).
 *
 * P2 ships the contract and a no-op composite; P4 wires the three channels
 * (AgentMail, Thread, badge). The composite runs every available channel in
 * parallel and never swallows a total failure silently — the caller surfaces
 * it to the est log and the card shows a red alert.
 */
import type { NotifyEvent } from './router.ts';
import type { ApprovalRequest } from './types.ts';
/** One out-of-band notification channel. */
export interface ApprovalNotifier {
    readonly id: string;
    /** Whether this channel can fire right now (its service is present). */
    isAvailable(ctx: unknown): boolean;
    /** Deliver one notification; throwing is allowed and treated as channel failure. */
    notify(ctx: unknown, request: ApprovalRequest): Promise<NotifyResult>;
}
export interface NotifyResult {
    channel: string;
    ok: boolean;
    detail?: string;
}
export interface NotifySummary {
    results: NotifyResult[];
    /** True when EVERY eligible channel failed. */
    totalFailure: boolean;
}
/** Run all eligible channels in parallel; each failure is isolated. */
export declare function dispatchApprovalNotifications(ctx: unknown, request: ApprovalRequest, channels: readonly ApprovalNotifier[]): Promise<NotifySummary>;
/**
 * Host adapters the three concrete channels need. The orchestration package is
 * dependency-free (no cordis / agent-team / tools imports), so the HOST glue
 * (packages/dag-team/src/sophia-approval.ts) supplies these closures from the
 * live application `Context`. Channels just call them.
 */
export interface NotifierHost {
    /** Send a human-targeted out-of-band email via the agent-mail tool, if present. */
    agentMail?: (subject: string, body: string) => Promise<void>;
    /** Post a Thread (with @human) on a ledger channel. */
    threadToHuman?: (channelId: string, body: string) => Promise<void>;
    /** Existing ledger channel to notify into (resolved by the glue). */
    channelId?: () => string;
    /** Surface the pending-owner count (badge channel). */
    badgeCount?: (count: number) => Promise<void>;
}
/** Shared mail/thread body builder (R8 template, dev-plan §4.6). */
export declare function approvalNoticeBody(request: ApprovalRequest): string;
/** Primary channel: human email via the host agent-mail tool (§9 O1). */
export declare class AgentMailNotifier implements ApprovalNotifier {
    private readonly host;
    readonly id = "agent-mail";
    constructor(host: NotifierHost);
    isAvailable(): boolean;
    notify(ctx: unknown, request: ApprovalRequest): Promise<NotifyResult>;
}
/** Fallback 1: ledger Thread + @human on a channel. */
export declare class ThreadNotifier implements ApprovalNotifier {
    private readonly host;
    readonly id = "thread";
    constructor(host: NotifierHost);
    isAvailable(): boolean;
    notify(ctx: unknown, request: ApprovalRequest): Promise<NotifyResult>;
}
/** Fallback 2: pure-client badge; host just surfaces the pending count. */
export declare class BadgeNotifier implements ApprovalNotifier {
    private readonly host;
    readonly id = "badge";
    constructor(host: NotifierHost);
    isAvailable(): boolean;
    notify(_ctx: unknown, request: ApprovalRequest): Promise<NotifyResult>;
}
/** Build the standard three-channel set in priority order. */
export declare function createApprovalChannels(host: NotifierHost): readonly ApprovalNotifier[];
/**
 * Composite backer for `FacadeOptions.notify`. Runs every eligible channel in
 * parallel for a NotifyEvent; a total failure is logged through the injected
 * logger (never silent §4.6).
 */
export declare function compositeNotifier(channels: readonly ApprovalNotifier[], log?: (message: string) => void): (event: NotifyEvent) => Promise<void>;
//# sourceMappingURL=notifier.d.ts.map