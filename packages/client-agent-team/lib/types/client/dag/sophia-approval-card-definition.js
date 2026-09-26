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
/** Approval states the card renders during (before materialization). */
const PENDING_STATES = new Set([
    'pending_owner',
    'pending_captain',
    'draft',
]);
/**
 * Parse the proposal-call fields the pending card owns: goal, team mode, and
 * the plan's member roster / task / dependency counts. The request id and
 * approval state are only produced by the execution result, so they are read
 * later in the update fold.
 */
export function parseSophiaProposeArgs(value) {
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null || !('goal' in parsed) || typeof parsed.goal !== 'string') {
            return undefined;
        }
        const goal = parsed.goal.trim();
        if (goal === '')
            return undefined;
        let mode;
        if ('mode' in parsed && (parsed.mode === 'persistent' || parsed.mode === 'dag'))
            mode = parsed.mode;
        const members = [];
        let taskCount = 0;
        let dependencyCount = 0;
        if ('plan' in parsed && typeof parsed.plan === 'object' && parsed.plan !== null) {
            const plan = parsed.plan;
            if (Array.isArray(plan.members)) {
                for (const member of plan.members) {
                    if (typeof member === 'object' && member !== null && 'name' in member && typeof member.name === 'string') {
                        const name = member.name.trim();
                        const role = 'role' in member && typeof member.role === 'string'
                            ? member.role
                            : '';
                        if (name !== '')
                            members.push({ name, role });
                    }
                }
            }
            if (Array.isArray(plan.tasks)) {
                taskCount = plan.tasks.length;
                for (const task of plan.tasks) {
                    if (typeof task === 'object' && task !== null && 'dependencies' in task
                        && Array.isArray(task.dependencies)) {
                        dependencyCount += task.dependencies.length;
                    }
                }
            }
        }
        return { goal, mode, members, taskCount, dependencyCount };
    }
    catch {
        return undefined;
    }
}
/**
 * Recover the request id / state / requester from the rendered proposal text.
 * The orchestration propose tool renders:
 *   `Proposal filed as request <id> (state <state>, requester <r>[, mode <m>]): "<goal>".`
 *   or the duplicate variant. `requester` is the string `human` for a human
 *   owner, otherwise the member's handle (or member id).
 */
export function parseSophiaProposeResult(text) {
    // Duplicate variant: "Duplicate proposal — request <id> for "<goal>" is
    // already pending (state <state>)."
    const duplicate = /Duplicate proposal — request (\S+) for .* is already pending \(state (\S+)\)/.exec(text);
    if (duplicate !== null) {
        return { requestId: duplicate[1] ?? '', state: duplicate[2] ?? '', requester: { isHuman: false }, mode: undefined, isDuplicate: true };
    }
    // Filed variant: "Proposal filed as request <id> (state <state>, requester <r>[,…]):"
    const filed = /Proposal filed as request (\S+) \(state (\S+), requester ([^),]+)(?:, mode (\S+))?\)/.exec(text);
    if (filed !== null) {
        const requested = filed[1] ?? '';
        const state = filed[2] ?? '';
        const requester = filed[3] ?? '';
        if (requested === '' || state === '')
            return undefined;
        const rawMode = filed[4];
        const mode = rawMode === 'persistent' || rawMode === 'dag' ? rawMode : undefined;
        return {
            requestId: requested,
            state,
            requester: requester === 'human' ? { isHuman: true } : { isHuman: false, handle: requester },
            mode,
            isDuplicate: false,
        };
    }
    return undefined;
}
/** Concatenate all visible text blocks in a tool-result message body. */
function textFromResult(content) {
    let out = '';
    for (const block of content) {
        if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text'
            && 'text' in block && typeof block.text === 'string') {
            out += block.text;
            out += '\n';
        }
    }
    return out;
}
/** Durable first-party tool events folded into one keyed Chat node. */
export const sophiaApprovalCardDefinition = {
    kind: 'sophia-approval',
    target: 'chat',
    match: (event) => {
        if (event.type === 'tool/call' && event.data.name === 'sophia_team_propose') {
            return parseSophiaProposeArgs(event.data.arguments) === undefined
                ? null
                : { id: String(event.data.callId), role: 'start' };
        }
        if (event.type === 'tool/result' && event.data.message.source.kind === 'tool') {
            return { id: String(event.data.message.source.callId), role: 'update' };
        }
        return null;
    },
    start: (_context, match) => {
        if (match.event.type !== 'tool/call') {
            throw new Error('sophia-approval card start requires sophia_team_propose tool/call');
        }
        const parsed = parseSophiaProposeArgs(match.event.data.arguments);
        if (parsed === undefined)
            throw new Error('sophia-approval card start requires valid proposal arguments');
        return {
            requestId: '',
            goal: parsed.goal,
            requester: { isHuman: false },
            mode: parsed.mode,
            state: '',
            members: parsed.members,
            taskCount: parsed.taskCount,
            dependencyCount: parsed.dependencyCount,
        };
    },
    update: (context, match) => {
        if (match.event.type !== 'tool/result')
            return context.state;
        const failed = match.event.data.error !== undefined
            || toolResultFailed(match.event.data.message);
        if (failed)
            return context.state;
        const text = textFromResult(match.event.data.message.content);
        const parsed = parseSophiaProposeResult(text);
        if (parsed === undefined)
            return context.state;
        const requester = parsed.requester.isHuman
            ? { isHuman: true }
            : { isHuman: false, handle: parsed.requester.handle };
        return {
            ...context.state,
            requestId: parsed.requestId,
            state: parsed.state,
            requester,
            mode: parsed.mode ?? context.state.mode,
        };
    },
    buildViewNode: (context) => {
        if (context.start === undefined)
            return null;
        const state = context.state;
        // Render ONLY while still pending (before materialization), and only once
        // the execution result has supplied a request id.
        if (state.requestId === '' || !PENDING_STATES.has(state.state))
            return null;
        return {
            key: context.key,
            kind: 'sophia-approval',
            id: context.id,
            target: 'chat',
            anchorSeq: context.start.event.seq,
            location: context.start.location,
            visibility: 'visible',
            data: {
                requestId: state.requestId,
                goal: state.goal,
                requester: state.requester,
                mode: state.mode,
                state: state.state,
                members: state.members,
                taskCount: state.taskCount,
                dependencyCount: state.dependencyCount,
            },
        };
    },
};
/** V4 tool-role results carry isError directly; older logs nest tool-result blocks. */
export function toolResultFailed(message) {
    return message.isError === true || message.content.some(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool-result'
        && 'isError' in block && block.isError === true);
}
