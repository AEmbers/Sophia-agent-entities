import type { AgentTeamClientMemberStatus } from 'dsh-sophia-entities/types';
import type { TeamSidebarProps } from './slots.ts';
import type { TeamStateDotState } from './TeamStateDot.tsx';
export declare function presenceLabel(status: AgentTeamClientMemberStatus, t: TeamSidebarProps['t']): string;
/** One line of human-readable diagnostic text: the reason, plus the refused artifact path when one was reported. */
export declare function diagnosticText(status: Pick<AgentTeamClientMemberStatus, 'diagnostic'>): string;
/**
 * Whether the restart action can help an unavailable Member: it heals
 * transient and repairable failures, but not a transient rollover window
 * (which resolves on its own) or a refusal already proven non-remediable.
 */
export declare function restartOffered(status: AgentTeamClientMemberStatus): boolean;
/** Shared presence → indicator mapping for dots and avatar badges. */
export declare function presenceDotState(presence: AgentTeamClientMemberStatus['presence']): TeamStateDotState;
export declare function TeamPresenceDot({ status, t }: {
    readonly status: AgentTeamClientMemberStatus;
    readonly t: TeamSidebarProps['t'];
}): import("react").JSX.Element;
//# sourceMappingURL=TeamPresenceDot.d.ts.map