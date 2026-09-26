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

import type {
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
// Module-loading imports: the declaration merges below extend modules that
// must be present in the program — a type-only import both loads them and is
// erased from the bundle.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-session/types'
import type { TeamMode } from 'dsh-sophia-entities/orchestration/types'

/** It is pending_owner / pending_captain / draft while awaiting approval. */
export type SophiaApprovalPendingState = 'pending_owner' | 'pending_captain' | 'draft'

/** Approval states the card renders during (before materialization). */
const PENDING_STATES: ReadonlySet<string> = new Set<SophiaApprovalPendingState>([
  'pending_owner',
  'pending_captain',
  'draft',
])

/** Final keyed Chat payload for the approval card. */
export interface SophiaApprovalCardData {
  readonly requestId: string
  readonly goal: string
  /** `isHuman` is true for a human owner proposal; a member initiator carries a handle. */
  readonly requester: {
    readonly isHuman: boolean
    readonly handle?: string
  }
  readonly mode: TeamMode | undefined
  readonly state: string
  readonly members: readonly {
    readonly name: string
    readonly role: string
  }[]
  /** The proposed task graph, so the card can show what depends on what. */
  readonly tasks: readonly {
    readonly id: string
    readonly subject: string
    readonly dependsOn: readonly string[]
  }[]
  readonly taskCount: number
  readonly dependencyCount: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Approval card anchoring a pending team proposal in the conversation. */
    'sophia-approval': SophiaApprovalCardData
  }
}

/** Folded proposal record (the node's business state). */
export interface SophiaApprovalNodeState {
  readonly requestId: string
  readonly goal: string
  readonly requester: {
    readonly isHuman: boolean
    readonly handle?: string
  }
  readonly mode: TeamMode | undefined
  readonly state: string
  readonly members: readonly {
    readonly name: string
    readonly role: string
  }[]
  readonly tasks: readonly {
    readonly id: string
    readonly subject: string
    readonly dependsOn: readonly string[]
  }[]
  readonly taskCount: number
  readonly dependencyCount: number
}

/**
 * Parse the proposal-call fields the pending card owns: goal, team mode, and
 * the plan's member roster / task / dependency counts. The request id and
 * approval state are only produced by the execution result, so they are read
 * later in the update fold.
 */
export function parseSophiaProposeArgs(value: string): {
  goal: string
  mode: TeamMode | undefined
  members: readonly { name: string; role: string }[]
  tasks: readonly { id: string; subject: string; dependsOn: readonly string[] }[]
  taskCount: number
  dependencyCount: number
} | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || !('goal' in parsed) || typeof parsed.goal !== 'string') {
      return undefined
    }
    const goal = parsed.goal.trim()
    if (goal === '') return undefined

    let mode: TeamMode | undefined
    if ('mode' in parsed && (parsed.mode === 'persistent' || parsed.mode === 'dag')) mode = parsed.mode

    const members: { name: string; role: string }[] = []
    const tasks: { id: string; subject: string; dependsOn: readonly string[] }[] = []
    let taskCount = 0
    let dependencyCount = 0
    if ('plan' in parsed && typeof parsed.plan === 'object' && parsed.plan !== null) {
      const plan = parsed.plan as { members?: unknown; tasks?: unknown }
      if (Array.isArray(plan.members)) {
        for (const member of plan.members) {
          if (typeof member === 'object' && member !== null && 'name' in member && typeof (member as { name: unknown }).name === 'string') {
            const name = (member as { name: string }).name.trim()
            const role = 'role' in member && typeof (member as { role: unknown }).role === 'string'
              ? (member as { role: string }).role
              : ''
            if (name !== '') members.push({ name, role })
          }
        }
      }
      if (Array.isArray(plan.tasks)) {
        taskCount = plan.tasks.length
        for (const task of plan.tasks) {
          if (typeof task !== 'object' || task === null) continue
          const dependsOn = 'dependencies' in task && Array.isArray((task as { dependencies: unknown }).dependencies)
            ? (task as { dependencies: readonly unknown[] }).dependencies.filter((item): item is string => typeof item === 'string')
            : []
          dependencyCount += dependsOn.length
          // A task without an id cannot be referenced by another task, so it is
          // not worth a row; the counts above still account for it.
          if (!('id' in task) || typeof (task as { id: unknown }).id !== 'string') continue
          const id = (task as { id: string }).id.trim()
          if (id === '') continue
          const subject = 'subject' in task && typeof (task as { subject: unknown }).subject === 'string'
            ? (task as { subject: string }).subject.trim()
            : ''
          tasks.push({ id, subject, dependsOn })
        }
      }
    }
    return { goal, mode, members, tasks, taskCount, dependencyCount }
  } catch {
    return undefined
  }
}

/**
 * Recover the request id / state / requester from the rendered proposal text.
 * The orchestration propose tool renders:
 *   `Proposal filed as request <id> (state <state>, requester <r>[, mode <m>]): "<goal>".`
 *   or the duplicate variant. `requester` is the string `human` for a human
 *   owner, otherwise the member's handle (or member id).
 */
export function parseSophiaProposeResult(text: string): {
  requestId: string
  state: string
  requester: { isHuman: boolean; handle?: string }
  mode: TeamMode | undefined
  isDuplicate: boolean
} | undefined {
  // Duplicate variant: "Duplicate proposal — request <id> for "<goal>" is
  // already pending (state <state>)."
  const duplicate = /Duplicate proposal — request (\S+) for .* is already pending \(state (\S+)\)/.exec(text)
  if (duplicate !== null) {
    return { requestId: duplicate[1] ?? '', state: duplicate[2] ?? '', requester: { isHuman: false }, mode: undefined, isDuplicate: true }
  }
  // Filed variant: "Proposal filed as request <id> (state <state>, requester <r>[,…]):"
  const filed = /Proposal filed as request (\S+) \(state (\S+), requester ([^),]+)(?:, mode (\S+))?\)/.exec(text)
  if (filed !== null) {
    const requested = filed[1] ?? ''
    const state = filed[2] ?? ''
    const requester = filed[3] ?? ''
    if (requested === '' || state === '') return undefined
    const rawMode = filed[4]
    const mode = rawMode === 'persistent' || rawMode === 'dag' ? rawMode : undefined
    return {
      requestId: requested,
      state,
      requester: requester === 'human' ? { isHuman: true } : { isHuman: false, handle: requester },
      mode,
      isDuplicate: false,
    }
  }
  return undefined
}

/** Concatenate all visible text blocks in a tool-result message body. */
function textFromResult(content: readonly unknown[]): string {
  let out = ''
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text'
      && 'text' in block && typeof (block as { text: unknown }).text === 'string') {
      out += (block as { text: string }).text
      out += '\n'
    }
  }
  return out
}

/** Durable first-party tool events folded into one keyed Chat node. */
export const sophiaApprovalCardDefinition: ConversationNodeDefinition<SophiaApprovalNodeState> = {
  kind: 'sophia-approval',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool/call' && event.data.name === 'sophia_team_propose') {
      return parseSophiaProposeArgs(event.data.arguments) === undefined
        ? null
        : { id: String(event.data.callId), role: 'start' }
    }
    if (event.type === 'tool/result' && event.data.message.source.kind === 'tool') {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    return null
  },
  start: (_context: ConversationNodeContext<SophiaApprovalNodeState>, match) => {
    if (match.event.type !== 'tool/call') {
      throw new Error('sophia-approval card start requires sophia_team_propose tool/call')
    }
    const parsed = parseSophiaProposeArgs(match.event.data.arguments)
    if (parsed === undefined) throw new Error('sophia-approval card start requires valid proposal arguments')
    return {
      requestId: '',
      goal: parsed.goal,
      requester: { isHuman: false },
      mode: parsed.mode,
      state: '',
      members: parsed.members,
      tasks: parsed.tasks,
      taskCount: parsed.taskCount,
      dependencyCount: parsed.dependencyCount,
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const failed = match.event.data.error !== undefined
      || toolResultFailed(match.event.data.message)
    if (failed) return context.state
    const text = textFromResult(match.event.data.message.content)
    const parsed = parseSophiaProposeResult(text)
    if (parsed === undefined) return context.state
    const requester: SophiaApprovalCardData['requester'] = parsed.requester.isHuman
      ? { isHuman: true }
      : { isHuman: false, handle: parsed.requester.handle }
    return {
      ...context.state,
      requestId: parsed.requestId,
      state: parsed.state,
      requester,
      mode: parsed.mode ?? context.state.mode,
    }
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    const state = context.state as SophiaApprovalNodeState
    // Render ONLY while still pending (before materialization), and only once
    // the execution result has supplied a request id.
    if (state.requestId === '' || !PENDING_STATES.has(state.state)) return null
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
        tasks: state.tasks,
        taskCount: state.taskCount,
        dependencyCount: state.dependencyCount,
      },
    }
  },
}

/** V4 tool-role results carry isError directly; older logs nest tool-result blocks. */
export function toolResultFailed(message: { readonly content: readonly unknown[]; readonly isError?: boolean }): boolean {
  return message.isError === true || message.content.some(block =>
    typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool-result'
    && 'isError' in block && block.isError === true)
}