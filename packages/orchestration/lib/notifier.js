/** Run all eligible channels in parallel; each failure is isolated. */
export async function dispatchApprovalNotifications(ctx, request, channels) {
    const results = await Promise.all(channels
        .filter((channel) => channel.isAvailable(ctx))
        .map(async (channel) => {
        try {
            await channel.notify(ctx, request);
            return { channel: channel.id, ok: true };
        }
        catch (error) {
            return { channel: channel.id, ok: false, detail: error.message };
        }
    }));
    return {
        results,
        totalFailure: results.length > 0 && results.every((result) => !result.ok),
    };
}
/** Shared mail/thread body builder (R8 template, dev-plan §4.6). */
export function approvalNoticeBody(request) {
    const lines = [
        `目标：${request.goal}`,
        `成员：${request.plan.members.length}（${request.plan.members.map((m) => m.name).slice(0, 3).join(', ')}）`,
        `任务：${request.plan.tasks.length}（含 ${request.plan.tasks.reduce((sum, t) => sum + t.dependencies.length, 0)} 条依赖）`,
    ];
    if (request.captainVerdict?.reason)
        lines.push(`队长意见：${request.captainVerdict.reason}`);
    if (request.requester.kind === 'member' && request.requester.handle) {
        lines.push(`发起者：@${request.requester.handle}`);
    }
    if (request.expiresAt !== undefined) {
        lines.push(`有效期至：${new Date(request.expiresAt).toLocaleString()}`);
    }
    lines.push('批准 / 退回：在审批卡片或计划面板中操作。');
    return lines.join('\n');
}
/** Primary channel: human email via the host agent-mail tool (§9 O1). */
export class AgentMailNotifier {
    host;
    id = 'agent-mail';
    constructor(host) {
        this.host = host;
    }
    isAvailable() {
        return typeof this.host.agentMail === 'function';
    }
    async notify(ctx, request) {
        if (!this.host.agentMail)
            throw new Error('agent-mail host adapter unavailable');
        const subject = `[dsh-sophia-entities] 待批准：持久化团队请求 #${request.id}`;
        await this.host.agentMail(subject, approvalNoticeBody(request));
        return { channel: this.id, ok: true };
    }
}
/** Fallback 1: ledger Thread + @human on a channel. */
export class ThreadNotifier {
    host;
    id = 'thread';
    constructor(host) {
        this.host = host;
    }
    isAvailable() {
        return typeof this.host.threadToHuman === 'function' && typeof this.host.channelId === 'function';
    }
    async notify(ctx, request) {
        if (!this.host.threadToHuman || !this.host.channelId) {
            throw new Error('thread host adapter unavailable');
        }
        await this.host.threadToHuman(this.host.channelId(), approvalNoticeBody(request));
        return { channel: this.id, ok: true };
    }
}
/** Fallback 2: pure-client badge; host just surfaces the pending count. */
export class BadgeNotifier {
    host;
    id = 'badge';
    constructor(host) {
        this.host = host;
    }
    isAvailable() {
        return true;
    }
    async notify(_ctx, request) {
        const count = request.state === 'pending_owner' ? 1 : 0;
        await this.host.badgeCount?.(count);
        return { channel: this.id, ok: true };
    }
}
/** Build the standard three-channel set in priority order. */
export function createApprovalChannels(host) {
    return [
        new AgentMailNotifier(host),
        new ThreadNotifier(host),
        new BadgeNotifier(host),
    ];
}
/**
 * Composite backer for `FacadeOptions.notify`. Runs every eligible channel in
 * parallel for a NotifyEvent; a total failure is logged through the injected
 * logger (never silent §4.6).
 */
export function compositeNotifier(channels, log) {
    return async (event) => {
        const summary = await dispatchApprovalNotifications(undefined, event.request, channels);
        if (summary.totalFailure) {
            const detail = summary.results.map((r) => `${r.channel}: ${r.detail ?? 'failed'}`).join('; ');
            log?.(`[dsh-sophia-entities] approval notice failed for ${event.request.id} (${event.kind}): ${detail}`);
        }
    };
}
