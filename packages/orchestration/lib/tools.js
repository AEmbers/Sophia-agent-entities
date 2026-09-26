/**
 * Approval tools (design §4.3).
 *
 * Three model-facing tools on top of the facade:
 *   sophia_team_propose  — anyone may file a proposal
 *   sophia_team_review   — the team captain reviews member proposals
 *   sophia_team_approve  — the Human owner approves/rejects
 *
 * Permission enforcement lives in the facade (review = captain, approve =
 * Human); the tools stay thin argument shims so the model never sees a
 * permission-bearing surface beyond its own role.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
/** Human-readable role summary of one planned member, for render text. */
function renderPlan(facade, plan) {
    const memberList = plan.members.length === 0
        ? '(no members yet)'
        : plan.members.map((m) => `${m.name}${m.role ? ` (${m.role})` : ''}`).join(', ');
    const taskList = plan.tasks.length === 0
        ? '(no tasks yet)'
        : plan.tasks.map((t) => `${t.id}: ${t.subject}${t.assignee ? ` → ${t.assignee}` : ''}`).join('; ');
    return `members: ${memberList}\ntasks: ${taskList}`;
}
/**
 * Register the three approval tools on a cordis context.
 * @returns the three definitions, for tool-surface composition (member tool
 *          filters include only `propose`, design §4.3.3).
 */
export function registerApprovalTools(ctx, dependencies) {
    const facade = dependencies.facade;
    const resolveCaller = dependencies.resolveCaller;
    const propose = defineTool({
        name: 'sophia_team_propose',
        description: 'Propose a new team to the approval queue. Anyone may call this: a member proposal goes to their captain for review, a Human-hosted proposal goes straight to the owner card. The owner approving materializes the real team (DAG subagent teams for mode=dag, persistent Human/agent teams for mode=persistent).',
        parameters: {
            goal: { type: 'string', required: true, description: 'The single goal the team will work on. Keep it tight and outcome-shaped.' },
            mode: {
                type: 'string',
                enum: ['persistent', 'dag'],
                description: 'Which backend the team should materialize into. Omit to leave the mode open for the picker.',
            },
            plan: {
                type: 'object',
                additionalProperties: false,
                description: 'Optional roster and task graph. Omit for a goal-only proposal the owner/captain can extend.',
                properties: {
                    members: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                name: { type: 'string', required: true },
                                role: { type: 'string' },
                                provider: { type: 'string' },
                                model: { type: 'string' },
                                reasoning_effort: { type: 'string' },
                            },
                        },
                    },
                    tasks: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true, description: 'Local reference usable as a dependency id.' },
                                subject: { type: 'string', required: true },
                                description: { type: 'string' },
                                assignee: { type: 'string' },
                                dependencies: { type: 'array', items: { type: 'string' } },
                            },
                        },
                    },
                },
            },
            reason: { type: 'string', description: 'Why this team should exist; shown to the reviewer and owner, and written into the audit record.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    request_id: { type: 'string', required: true },
                    state: { type: 'string', required: true },
                    duplicate: { type: 'boolean' },
                    requester: { type: 'string', required: true },
                    mode: { type: 'string' },
                    goal: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: value.duplicate === true
                        ? `Duplicate proposal — request ${value.request_id} for "${value.goal}" is already pending (state ${value.state}).`
                        : `Proposal filed as request ${value.request_id} (state ${value.state}, requester ${value.requester}${value.mode ? `, mode ${value.mode}` : ''}): "${value.goal}".`
                            + (args.plan ? `\n${renderPlan(facade, args.plan)}` : ''),
                }],
        },
        async execute(args, exec) {
            const caller = await resolveCaller(exec);
            const facet = { isHuman: caller.isHuman, sessionId: caller.sessionId, handle: caller.handle, teamId: caller.teamId };
            const result = await facade.propose(facet, {
                goal: args.goal,
                mode: args.mode,
                plan: args.plan
                    ? {
                        members: args.plan.members.map((m) => ({
                            name: m.name,
                            role: m.role,
                            provider: m.provider,
                            model: m.model,
                            reasoningEffort: m.reasoning_effort,
                        })),
                        tasks: args.plan.tasks.map((t) => ({
                            id: t.id,
                            subject: t.subject,
                            description: t.description,
                            assignee: t.assignee,
                            dependencies: t.dependencies ?? [],
                        })),
                    }
                    : undefined,
            });
            return {
                request_id: result.request.id,
                state: result.request.state,
                duplicate: result.duplicate === true ? true : undefined,
                requester: result.request.requester.kind === 'human' ? 'human' : (result.request.requester.handle ?? result.request.requester.memberId ?? 'member'),
                mode: result.request.mode,
                goal: result.request.goal,
            };
        },
    });
    const review = defineTool({
        name: 'sophia_team_review',
        description: 'Captain-only review of a member team proposal awaiting your verdict (state pending_captain). approve_dag or downgrade_to_dag materializes the DAG team immediately; approve_persistent escalates to the Human owner card; reject closes it. A downgrade requires a reason that is written into the audit record.',
        parameters: {
            request_id: { type: 'string', required: true, description: 'Approval request id, e.g. from sophia_team_propose.' },
            decision: {
                type: 'string', required: true,
                enum: ['approve_dag', 'approve_persistent', 'downgrade_to_dag', 'reject'],
                description: 'approve_dag: build the DAG team now. approve_persistent: escalate to the owner. downgrade_to_dag: owner wanted persistent but you pick DAG (reason required). reject: close it.',
            },
            reason: { type: 'string', description: 'Required for downgrade_to_dag; recommended for every verdict; stored in the audit record.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    request_id: { type: 'string', required: true },
                    state: { type: 'string', required: true },
                    materialized: { type: 'boolean' },
                    team_ref: { type: 'string' },
                    team_name: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: value.materialized === true
                        ? `Request ${value.request_id} → ${value.state}: team ${value.team_name ?? value.team_ref} is live (${value.team_ref}).`
                        : `Request ${value.request_id} → ${value.state}.`,
                }],
        },
        async execute(args, exec) {
            const caller = await resolveCaller(exec);
            const facet = { isHuman: caller.isHuman, sessionId: caller.sessionId, handle: caller.handle, teamId: caller.teamId };
            const result = await facade.review(facet, args.request_id, {
                decision: args.decision,
                reason: args.reason ?? '',
            });
            const materialized = result.materialized;
            return {
                request_id: result.request.id,
                state: result.request.state,
                materialized: materialized !== undefined ? true : undefined,
                team_ref: materialized?.teamRef,
                team_name: materialized?.teamName,
            };
        },
    });
    const approve = defineTool({
        name: 'sophia_team_approve',
        description: 'Human-owner-only decision on a proposal waiting on the owner card (state pending_owner or draft). You must supply the concrete mode for approval. On approve the requested team materializes through the chosen backend (persistent = ledger Human/agent team, dag = DAG subagent team).',
        parameters: {
            request_id: { type: 'string', required: true },
            decision: {
                type: 'string', required: true, enum: ['approve', 'reject'],
                description: 'approve materializes the team; reject closes the request.',
            },
            mode: {
                type: 'string', enum: ['persistent', 'dag'],
                description: 'Required when decision=approve and the request has no mode yet.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    request_id: { type: 'string', required: true },
                    state: { type: 'string', required: true },
                    materialized: { type: 'boolean' },
                    mode: { type: 'string' },
                    team_ref: { type: 'string' },
                    team_name: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: value.materialized === true
                        ? `Request ${value.request_id} → ${value.state} (${value.mode}): team ${value.team_name ?? value.team_ref} is live (${value.team_ref}).`
                        : `Request ${value.request_id} → ${value.state}.`,
                }],
        },
        async execute(args, exec) {
            const caller = await resolveCaller(exec);
            const facet = { isHuman: caller.isHuman, sessionId: caller.sessionId, handle: caller.handle, teamId: caller.teamId };
            const result = await facade.approve(facet, args.request_id, {
                decision: args.decision,
                mode: args.mode,
            });
            const materialized = result.materialized;
            return {
                request_id: result.request.id,
                state: result.request.state,
                materialized: materialized !== undefined ? true : undefined,
                mode: result.request.mode,
                team_ref: materialized?.teamRef,
                team_name: materialized?.teamName,
            };
        },
    });
    ctx.tools.register(propose);
    ctx.tools.register(review);
    ctx.tools.register(approve);
    return { propose, review, approve };
}
