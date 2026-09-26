/** Display-name budget for the materialized Channel (board: goal truncated to ~80 chars). */
const CHANNEL_NAME_MAX = 80;
/** Truncate by code points so surrogate pairs (emoji) are never split. */
function truncateText(text, max) {
    const points = [...text];
    return points.length <= max ? text : points.slice(0, max).join('');
}
/**
 * Create the persistent backend bound to one host + workspace.
 *
 * `describe`/`list` resolve teams through `host.view({ workspaceId })` reading
 * as the Human (no memberId filter, so the whole workspace is visible) and map
 * each Channel to a `TeamSummary`. `teamRef` is `${workspaceId}/${channelRef}`;
 * `describe` also tolerates a bare `channelRef` (falls back to this workspace).
 */
export function createSophiaPersistentBackend(deps) {
    const workspaceId = deps.workspaceId;
    /** Epoch of each materialized team, recorded at create time (channels expose only a sequence). */
    const createdAtByChannel = new Map();
    const requestId = (stamp) => stamp;
    const summary = (channel, memberCount, taskCount, teamWorkspaceId = workspaceId) => Object.freeze({
        mode: 'persistent',
        teamId: `${teamWorkspaceId}/${channel.channelRef}`,
        name: channel.name,
        memberCount,
        taskCount,
        createdAt: createdAtByChannel.get(channel.channelRef) ?? 0,
    });
    return Object.freeze({
        mode: 'persistent',
        async create(_ctx, request) {
            // 1) Channel first: the durable team identity; no initial members (each
            //    planned member is added explicitly so participation seeds to this
            //    workspace).
            const channelResult = await deps.host.createChannel({
                requestId: requestId(`persistent:channel:${request.id}`),
                workspaceId,
                name: truncateText(request.goal, CHANNEL_NAME_MAX),
                description: request.goal,
                memberIds: [],
            });
            const channel = channelResult.channel;
            createdAtByChannel.set(channel.channelRef, Date.now());
            // 2) Members: the host provisions one ledger Agent Member per planned
            //    member — it generates the member identity (memberId/sessionId/
            //    privateMemoryPath) and seeds the creation Workspace participation.
            //    Model selection is taken from the plan; the returned stored member
            //    (handle → memberId) keys the assignee map below.
            const memberIdByHandle = new Map();
            for (const [index, planned] of request.plan.members.entries()) {
                const model = planned.provider === undefined || planned.model === undefined ? undefined
                    : Object.freeze({
                        provider: planned.provider,
                        model: planned.model,
                        ...(planned.reasoningEffort === undefined ? {} : { reasoningEffort: planned.reasoningEffort }),
                    });
                const memberResult = await deps.host.addMember({
                    requestId: requestId(`persistent:member:${request.id}:${index}`),
                    workspaceId,
                    handle: planned.name,
                    description: planned.role ?? '',
                    presetId: 'team-member',
                    ...(model === undefined ? {} : { model }),
                    channelRefs: Object.freeze([channel.channelRef]),
                });
                const stored = memberResult.status.member;
                memberIdByHandle.set(stored.handle, stored.memberId);
            }
            // 3) Tasks: one atomic Message+Thread+Task('todo') per planned task, so
            //    every task is durable, sequential and owned by a Thread. The task
            //    decision is attributed to the Human sender; the assignee (matched by
            //    member name) follows the task through its inbox via `recipients`.
            for (const planned of request.plan.tasks) {
                const subject = planned.subject.trim();
                const assigneeMemberId = planned.assignee === undefined ? undefined : memberIdByHandle.get(planned.assignee);
                await deps.host.sendMessage({
                    requestId: requestId(`persistent:task:${request.id}:${planned.id}`),
                    workspaceId,
                    channelRef: channel.channelRef,
                    body: subject === '' ? planned.id : subject,
                    ...(assigneeMemberId === undefined ? {} : { recipients: Object.freeze([assigneeMemberId]) }),
                    asTask: true,
                });
            }
            return Object.freeze({
                mode: 'persistent',
                teamRef: `${workspaceId}/${channel.channelRef}`,
                teamName: channel.name,
                detail: `ledger team materialized from approval '${request.id}'`,
            });
        },
        async describe(_ctx, teamRef) {
            const slash = teamRef.lastIndexOf('/');
            const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash);
            const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1));
            const view = deps.host.view({ workspaceId: resolvedWorkspace });
            const channel = view.channels.find(candidate => candidate.channelRef === channelRef);
            if (channel === undefined)
                return undefined;
            return summary(channel, view.members.filter(membership => membership.channelRef === channelRef).length, view.tasks.filter(task => task.channelRef === channelRef).length);
        },
        async list(_ctx) {
            const view = deps.host.view({ workspaceId });
            return view.channels.map(channel => summary(channel, view.members.filter(membership => membership.channelRef === channel.channelRef).length, view.tasks.filter(task => task.channelRef === channel.channelRef).length));
        },
    });
}
