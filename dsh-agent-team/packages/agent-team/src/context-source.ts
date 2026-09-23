/**
 * Plugin-attributed message sources for Agent Team context management.
 *
 * Both sources ride ordinary `UserMessage`s under the shipped `plugin` kind
 * with the `snapshot` context form — the same shape the Harness's own
 * system-prompt producer writes. This module declares no `MessageSourceMap`
 * member of its own, and carries no bespoke source members: Session format
 * migration validates a `plugin` source against a closed member list
 * (`kind`, `plugin`, `form`, `sections`, `summary`), and refuses every logged
 * Session that carries anything else. A plugin-declared kind is type-legal yet
 * refused the same way. See `docs/dsh-release-compatibility.md`
 * § "Session message sources".
 *
 * Everything the Host needs to read back therefore rides the admitted payload
 * slots: the handoff envelope and the checkpoint correlation both travel as
 * named {@link ContextSnapshotSection} contributions, distinguished by their
 * stable section names. Sections are the format's designed slot for structured
 * producer payload, and they render as named contributions on any
 * snapshot-aware surface.
 *
 * The validators below are the single place that recognizes these messages, so
 * callers never match on localized body text. Writing them belongs to the
 * context-continuity engine's codec, which Team constructs with its own plugin
 * identity and prose (`context-continuity-host.ts`): one writer, so the
 * envelope Team reads back can never drift from the one it wrote.
 * @module @wowyuarm/dsh-agent-team/context-source
 */

import type { ContextSnapshotSection, UserMessage } from '@deepseek-ai/dsh-llm'

/** Plugin identity attributing every Agent Team message source. */
export const AGENT_TEAM_PLUGIN_ID = '@wowyuarm/dsh-agent-team'

/** Handoff snapshot section name carrying the model-authored prose. */
export const HANDOFF_SECTION_NAME = 'HANDOFF'

/** Stable section name marking a checkpoint continuation and carrying its ref. */
export const CHECKPOINT_SECTION_NAME = 'Checkpoint'

/**
 * The rollover handoff envelope: the model-authored prose plus the verifiable
 * Host facts, all as named snapshot contributions.
 */
export interface AgentTeamContextHandoff {
  /** The Member's Session before this rollover. */
  readonly previousSessionId: string
  /** The rollover generation this handoff opened. */
  readonly newSessionId: string
  /** Why the rollover happened. */
  readonly trigger: 'model' | 'pressure'
  /** Seq of the successful `context_rollover` tool result in the previous Session log. */
  readonly handoffEventSeq: number
  /** The checkpoint a return was seeded from; absent on a fresh rollover. */
  readonly checkpointRef?: string
  /** Workspace paths the handoff called out as relevant. */
  readonly relatedFiles?: readonly string[]
  /** Named contributions, starting with the model-authored handoff prose. */
  readonly sections: readonly ContextSnapshotSection[]
}

/**
 * Read one message's snapshot sections when it is this plugin's own snapshot.
 * @param message - candidate user message.
 * @returns the sections, or `undefined` when another producer owns the message.
 */
function ownSections(message: UserMessage): readonly ContextSnapshotSection[] | undefined {
  const source = message.source
  if (source.kind !== 'plugin' || source.plugin !== AGENT_TEAM_PLUGIN_ID) return undefined
  if (source.form !== 'snapshot') return undefined
  return source.sections
}

/** The text of one named section, or undefined when it is absent. */
function sectionText(sections: readonly ContextSnapshotSection[], name: string): string | undefined {
  return sections.find(section => section.name === name)?.text
}

/**
 * Decode the `Related files` section. The Host writes the exact path array as
 * JSON, which round-trips every path a file system admits — including one
 * containing a comma, which the `', '`-joined form this replaced could not.
 * Sections written before that encoding are still read; the legacy split is a
 * read-side accommodation for old generations, never a write path.
 */
function parseRelatedFiles(text: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed) && parsed.every(path => typeof path === 'string' && path.length > 0)) {
      return parsed as readonly string[]
    }
  } catch {
    // Not JSON: the section predates the JSON encoding.
  }
  return text.split(', ').filter(path => path.length > 0)
}

/**
 * The rollover handoff one message carries, when it is one.
 * @param message - candidate user message.
 * @returns the envelope, or `undefined` when the message is not a handoff.
 */
export function handoffOf(message: UserMessage): AgentTeamContextHandoff | undefined {
  const sections = ownSections(message)
  if (sections === undefined) return undefined
  const handoff = sectionText(sections, HANDOFF_SECTION_NAME)
  if (handoff === undefined) return undefined
  const previousSessionId = sectionText(sections, HANDOFF_PREVIOUS_SESSION)
  const newSessionId = sectionText(sections, HANDOFF_NEW_SESSION)
  const trigger = sectionText(sections, HANDOFF_TRIGGER)
  const handoffEventSeq = sectionText(sections, HANDOFF_EVENT_SEQ)
  if (previousSessionId === undefined || newSessionId === undefined) return undefined
  if (trigger !== 'model' && trigger !== 'pressure') return undefined
  const seq = Number(handoffEventSeq)
  if (handoffEventSeq === undefined || !Number.isSafeInteger(seq)) return undefined
  const checkpointRef = sectionText(sections, HANDOFF_CHECKPOINT)
  const relatedFiles = sectionText(sections, HANDOFF_RELATED_FILES)
  return {
    previousSessionId,
    newSessionId,
    trigger,
    handoffEventSeq: seq,
    ...(checkpointRef === undefined ? {} : { checkpointRef }),
    ...(relatedFiles === undefined ? {} : { relatedFiles: parseRelatedFiles(relatedFiles) }),
    sections,
  }
}

/**
 * The checkpoint ref one continuation notice carries, when the message is one.
 * @param message - candidate user message.
 * @returns the checkpoint ref, or `undefined` when the message is not a continuation.
 */
export function continuationCheckpointRefOf(message: UserMessage): string | undefined {
  const sections = ownSections(message)
  if (sections === undefined || sections.length !== 1) return undefined
  const ref = sectionText(sections, CHECKPOINT_SECTION_NAME)
  return ref === undefined || ref.length === 0 ? undefined : ref
}

/** Whether one user message is a rollover handoff snapshot. */
export function isHandoffMessage(message: UserMessage): boolean {
  return handoffOf(message) !== undefined
}

/** Whether one user message is a checkpoint continuation, optionally for one checkpoint. */
export function isCheckpointContinuationMessage(message: UserMessage, checkpointRef?: string): boolean {
  const ref = continuationCheckpointRefOf(message)
  return ref !== undefined && (checkpointRef === undefined || ref === checkpointRef)
}

/**
 * Whether one message carries a rollover-handoff or checkpoint-continuation
 * envelope. Ordinary Team notices share this plugin's attribution, so callers
 * that replace rederived notices must exclude these two families explicitly.
 */
export function isAgentTeamContextSource(message: UserMessage): boolean {
  return isHandoffMessage(message) || isCheckpointContinuationMessage(message)
}

/** Envelope section names; stable, because they are read back from the log.
 * Exported for the legacy-artifact remediation, which rewrites pre-0.1.10
 * envelopes into exactly these names — one shared vocabulary, no drift. */
export const HANDOFF_PREVIOUS_SESSION = 'Previous session'
export const HANDOFF_NEW_SESSION = 'New session'
export const HANDOFF_TRIGGER = 'Trigger'
export const HANDOFF_EVENT_SEQ = 'Handoff event seq'
export const HANDOFF_CHECKPOINT = 'Continued from checkpoint'
export const HANDOFF_RELATED_FILES = 'Related files'
