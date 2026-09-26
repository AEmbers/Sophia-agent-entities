/**
 * Producer-attributed message sources for Agent Team context management.
 *
 * Both sources ride ordinary `UserMessage`s under this plugin's own
 * producer kind with the `snapshot` context form — Session format V4 admits
 * exactly that shape and refuses the retired `{ kind: 'plugin', plugin: … }`
 * wrapper at write time. See `docs/dsh-release-compatibility.md`
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
 * @module dsh-sophia-entities/context-source
 */
import type { ContextFormed, ContextSnapshotSection, MessageSource, UserMessage } from '@deepseek-ai/dsh-llm';
/** The producer kind attributing every Agent Team message source. */
export declare const AGENT_TEAM_PLUGIN_ID = "dsh-sophia-entities";
/**
 * The kind the Harness's V4 read-time conversion renames this plugin's
 * released V3 `plugin` sources into: `plugin:` + the producer id, with the
 * `plugin` key dropped and every payload field (`form`, `sections`,
 * `summary`) preserved. History read through the new line carries exactly
 * this shape, so the read side recognizes both identities below.
 */
export declare const AGENT_TEAM_V3_RENAMED_KIND = "plugin:dsh-sophia-entities";
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** The kind this plugin writes now; V4 admission requires a producer-owned kind. */
        [AGENT_TEAM_PLUGIN_ID]: {
            kind: typeof AGENT_TEAM_PLUGIN_ID;
        } & ContextFormed;
        /** The converted shape of this plugin's released V3 history; read-side only. */
        [AGENT_TEAM_V3_RENAMED_KIND]: {
            kind: typeof AGENT_TEAM_V3_RENAMED_KIND;
        } & ContextFormed;
    }
}
/** The source shapes carrying this plugin's attribution: its current kind and the read-time conversion of its V3 history. */
export type AgentTeamMessageSource = Extract<MessageSource, {
    kind: typeof AGENT_TEAM_PLUGIN_ID | typeof AGENT_TEAM_V3_RENAMED_KIND;
}>;
/** The kind the read-time conversion renames one producer's released V3 sources into. */
export declare const v3RenamedSourceKind: <const P extends string>(producer: P) => `plugin:${P}`;
/**
 * Whether one message source carries this plugin's own attribution. Both
 * identities are matched by exact kind equality — never by a `plugin:`
 * prefix test, which would claim third-party producers' rows as Team facts.
 */
export declare function isAgentTeamSource(source: MessageSource): source is AgentTeamMessageSource;
/**
 * Whether one source kind carries this plugin's attribution, for call sites
 * whose sources arrive untyped. Exact identities only, never a prefix test.
 */
export declare function isAgentTeamSourceKind(kind: string | undefined): boolean;
/** Handoff snapshot section name carrying the model-authored prose. */
export declare const HANDOFF_SECTION_NAME = "HANDOFF";
/** Stable section name marking a checkpoint continuation and carrying its ref. */
export declare const CHECKPOINT_SECTION_NAME = "Checkpoint";
/**
 * The rollover handoff envelope: the model-authored prose plus the verifiable
 * Host facts, all as named snapshot contributions.
 */
export interface AgentTeamContextHandoff {
    /** The Member's Session before this rollover. */
    readonly previousSessionId: string;
    /** The rollover generation this handoff opened. */
    readonly newSessionId: string;
    /** Why the rollover happened. */
    readonly trigger: 'model' | 'pressure';
    /** Seq of the successful `context_rollover` tool result in the previous Session log. */
    readonly handoffEventSeq: number;
    /** The checkpoint a return was seeded from; absent on a fresh rollover. */
    readonly checkpointRef?: string;
    /** Workspace paths the handoff called out as relevant. */
    readonly relatedFiles?: readonly string[];
    /** Named contributions, starting with the model-authored handoff prose. */
    readonly sections: readonly ContextSnapshotSection[];
}
/**
 * The rollover handoff one message carries, when it is one.
 * @param message - candidate user message.
 * @returns the envelope, or `undefined` when the message is not a handoff.
 */
export declare function handoffOf(message: UserMessage): AgentTeamContextHandoff | undefined;
/**
 * The checkpoint ref one continuation notice carries, when the message is one.
 * @param message - candidate user message.
 * @returns the checkpoint ref, or `undefined` when the message is not a continuation.
 */
export declare function continuationCheckpointRefOf(message: UserMessage): string | undefined;
/** Whether one user message is a rollover handoff snapshot. */
export declare function isHandoffMessage(message: UserMessage): boolean;
/** Whether one user message is a checkpoint continuation, optionally for one checkpoint. */
export declare function isCheckpointContinuationMessage(message: UserMessage, checkpointRef?: string): boolean;
/**
 * Whether one message carries a rollover-handoff or checkpoint-continuation
 * envelope. Ordinary Team notices share this plugin's attribution, so callers
 * that replace rederived notices must exclude these two families explicitly.
 */
export declare function isAgentTeamContextSource(message: UserMessage): boolean;
/** Envelope section names; stable, because they are read back from the log.
 * One shared vocabulary for writer and reader — no drift between the shape
 * published at rollover and the shape the projection folds back. */
export declare const HANDOFF_PREVIOUS_SESSION = "Previous session";
export declare const HANDOFF_NEW_SESSION = "New session";
export declare const HANDOFF_TRIGGER = "Trigger";
export declare const HANDOFF_EVENT_SEQ = "Handoff event seq";
export declare const HANDOFF_CHECKPOINT = "Continued from checkpoint";
export declare const HANDOFF_RELATED_FILES = "Related files";
//# sourceMappingURL=context-source.d.ts.map