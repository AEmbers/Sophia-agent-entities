/**
 * Persistent (ledger-backed) team backend for the orchestration approval plane.
 *
 * `createSophiaPersistentBackend` builds the `TeamBackend` that materializes an
 * owner-approved plan into an `AgentTeamLedger` team: one Channel named after
 * the approved goal, one Agent Member per `plan.members`, and one Task per
 * `plan.tasks`. All ledger mutations are submitted with the Human actor —
 * `agentTeamHumanActor()` (ledger identity `AGENT_TEAM_HUMAN_MEMBER_ID`).
 *
 * SEMANTICS —「主人批准后代为提交」(design §4.8 point 3): this backend runs only
 * after the owner has approved the request; it then commits the approved plan
 * into the ledger ON THE HUMAN's behalf, exactly as approved. This is NOT a
 * permission bypass: the ledger's `assertHumanActor` still requires the durable
 * Human identity (`member:human`), and every operation is attributed to it and
 * becomes part of the audit trail. The backend supplies no authority of its
 * own — it is a deterministic projection of one approved `ApprovalRequest` onto
 * the ledger's public surface.
 *
 * KNOWN LIMITATIONS (reported to the Lead; ledger.ts stays untouched):
 * - `AgentTeamTask` carries no `assignee` / `decidedBy` fields: "decided by the
 *   Human" is evidenced by the Human sender on the task-creating message, and a
 *   planned `assignee` (matched by member name) is approximated via the message
 *   `recipients` (the assignee's inbox references the task).
 * - A ledger Channel has `createdAtSequence` (an operation sequence, not an
 *   epoch), so `TeamSummary.createdAt` is captured at materialization time in a
 *   closure map and falls back to `0` after a host restart.
 * - Every create call uses deterministic requestIds derived from the approval
 *   request id, so un-awaited retries resolve idempotently inside the ledger.
 */
import { randomUUID } from 'node:crypto'

import { AgentTeamLedger, agentTeamHumanActor } from './ledger.ts'
import { memberMemoryDirectoryName } from './member-runtime.ts'
import type { AgentTeamAgentMember, AgentTeamChannel, AgentTeamChannelRef, AgentTeamMemberId, AgentTeamRequestId } from './types/entities.ts'
import type {
  ApprovalRequest,
  MaterializeResult,
  TeamBackend,
  TeamSummary,
} from 'dsh-sophia-entities/orchestration'

/** Brand derivation keeps this file to relative imports + the orchestration type import. */
type WorkspaceId = AgentTeamAgentMember['workspaceId']
type SessionId = AgentTeamAgentMember['sessionId']
type ReasoningEffortId = NonNullable<NonNullable<AgentTeamAgentMember['model']>['reasoningEffort']>

export interface SophiaPersistentBackendDeps {
  readonly ledger: AgentTeamLedger
  /** The workspace the materialized team lives in (matches the channel workspace so member participation seeds correctly). */
  readonly workspaceId: string
}

/** Display-name budget for the materialized Channel (board: goal truncated to ~80 chars). */
const CHANNEL_NAME_MAX = 80

/** Truncate by code points so surrogate pairs (emoji) are never split. */
function truncateText(text: string, max: number): string {
  const points = [...text]
  return points.length <= max ? text : points.slice(0, max).join('')
}

/** Member private-memory path convention: mirrors the host `dshHomePath('agent-team','members', …)` final segment. */
function privateMemoryPathFor(memberId: AgentTeamMemberId): string {
  return `agent-team/members/${memberMemoryDirectoryName(memberId)}`
}

/**
 * Create the persistent backend bound to one ledger + workspace.
 *
 * `describe`/`list` resolve teams through `ledger.view({ workspaceId })` reading
 * as the Human (no memberId filter, so the whole workspace is visible) and map
 * each Channel to a `TeamSummary`. `teamRef` is `${workspaceId}/${channelRef}`;
 * `describe` also tolerates a bare `channelRef` (falls back to this workspace).
 */
export function createSophiaPersistentBackend(deps: SophiaPersistentBackendDeps): TeamBackend {
  const workspaceId = deps.workspaceId as WorkspaceId
  const human = agentTeamHumanActor()
  /** Epoch of each materialized team, recorded at create time (channels expose only a sequence). */
  const createdAtByChannel = new Map<AgentTeamChannelRef, number>()
  const requestId = (stamp: string): AgentTeamRequestId => stamp as AgentTeamRequestId

  const summary = (channel: AgentTeamChannel, memberCount: number, taskCount: number, teamWorkspaceId: WorkspaceId = workspaceId): TeamSummary =>
    Object.freeze({
      mode: 'persistent' as const,
      teamId: `${teamWorkspaceId}/${channel.channelRef}`,
      name: channel.name,
      memberCount,
      taskCount,
      createdAt: createdAtByChannel.get(channel.channelRef) ?? 0,
    })

  return Object.freeze({
    mode: 'persistent' as const,

    async create(_ctx: unknown, request: ApprovalRequest): Promise<MaterializeResult> {
      // 1) Channel first: the durable team identity; no initial members (each
      //    planned member is added explicitly so participation seeds to this
      //    workspace).
      const channelResult = await deps.ledger.createChannel({
        requestId: requestId(`persistent:channel:${request.id}`),
        workspaceId,
        name: truncateText(request.goal, CHANNEL_NAME_MAX),
        description: request.goal,
        memberIds: [],
        actor: human,
      })
      const channel = channelResult.value.channel
      createdAtByChannel.set(channel.channelRef, Date.now())

      // 2) Members: one ledger Agent Member per planned member, branded with a
      //    fresh `member:<uuid>` identity, model selection taken from the plan.
      const memberIdByHandle = new Map<string, AgentTeamMemberId>()
      for (const [index, planned] of request.plan.members.entries()) {
        const memberId = `member:${randomUUID()}` as AgentTeamMemberId
        memberIdByHandle.set(planned.name, memberId)
        const model = planned.provider === undefined || planned.model === undefined ? undefined
          : Object.freeze({
              provider: planned.provider,
              model: planned.model,
              ...(planned.reasoningEffort === undefined ? {} : { reasoningEffort: planned.reasoningEffort as ReasoningEffortId }),
            })
        const member: AgentTeamAgentMember = Object.freeze({
          memberId,
          sessionId: `agent-team-${randomUUID()}` as SessionId,
          workspaceId,
          handle: planned.name,
          description: planned.role ?? '',
          presetId: 'team-member',
          ...(model === undefined ? {} : { model }),
          privateMemoryPath: privateMemoryPathFor(memberId),
          state: 'enabled',
        })
        await deps.ledger.addMember({
          requestId: requestId(`persistent:member:${request.id}:${index}`),
          workspaceId,
          handle: planned.name,
          description: planned.role ?? '',
          presetId: 'team-member',
          ...(model === undefined ? {} : { model }),
          channelRefs: Object.freeze([channel.channelRef]),
          actor: human,
          member,
        })
      }

      // 3) Tasks: one atomic Message+Thread+Task('todo') per planned task, so
      //    every task is durable, sequential and owned by a Thread. The task
      //    decision is attributed to the Human sender; the assignee (matched by
      //    member name) follows the task through its inbox via `recipients`.
      for (const planned of request.plan.tasks) {
        const subject = planned.subject.trim()
        const assigneeMemberId = planned.assignee === undefined ? undefined : memberIdByHandle.get(planned.assignee)
        await deps.ledger.sendMessage({
          requestId: requestId(`persistent:task:${request.id}:${planned.id}`),
          workspaceId,
          channelRef: channel.channelRef,
          body: subject === '' ? planned.id : subject,
          ...(assigneeMemberId === undefined ? {} : { recipients: Object.freeze([assigneeMemberId]) }),
          asTask: true,
          actor: human,
        })
      }

      return Object.freeze({
        mode: 'persistent' as const,
        teamRef: `${workspaceId}/${channel.channelRef}`,
        teamName: channel.name,
        detail: `ledger team materialized from approval '${request.id}'`,
      })
    },

    async describe(_ctx: unknown, teamRef: string): Promise<TeamSummary | undefined> {
      const slash = teamRef.lastIndexOf('/')
      const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash) as WorkspaceId
      const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1)) as AgentTeamChannelRef
      const view = deps.ledger.view({ workspaceId: resolvedWorkspace })
      const channel = view.channels.find(candidate => candidate.channelRef === channelRef)
      if (channel === undefined) return undefined
      return summary(
        channel,
        view.members.filter(membership => membership.channelRef === channelRef).length,
        view.tasks.filter(task => task.channelRef === channelRef).length,
      )
    },

    async list(_ctx: unknown): Promise<TeamSummary[]> {
      const view = deps.ledger.view({ workspaceId })
      return view.channels.map(channel => summary(
        channel,
        view.members.filter(membership => membership.channelRef === channel.channelRef).length,
        view.tasks.filter(task => task.channelRef === channel.channelRef).length,
      ))
    },
  })
}