import type { AgentTeamClientMemberStatus } from 'dsh-sophia-entities/types';
import type { TeamSidebarProps } from './slots.ts';
/** One membership action: what it says and which Member it acts on. */
export interface TeamMemberAction {
    readonly label: string;
    readonly onSelect: () => void;
    readonly disabled?: boolean;
}
/**
 * The one place a Member's identity is drawn: the presence-bearing avatar plus
 * the handle over its description. Read-only rosters, the rosters with a
 * membership action, and the sidebar Agent list all render this, so identity,
 * tone and truncation cannot drift between surfaces that show the same person.
 *
 * A fragment, not a row: each surface owns its own row element, hit target and
 * grid, and places this identity in that grid's first two tracks. The handle
 * spelling is the surface's call — rosters address Members the way the
 * composer does (`@handle`), the sidebar names them as the directory does.
 */
export declare function TeamMemberIdentity({ status, name, className, t }: {
    readonly status: AgentTeamClientMemberStatus;
    /** Handle spelling for this surface; defaults to the mention form. */
    readonly name?: string | undefined;
    /** Surface-local copy hook (sidebar line heights, dialog density). */
    readonly className?: string | undefined;
    readonly t: TeamSidebarProps['t'];
}): import("react").JSX.Element;
/**
 * The one roster row: identity, an optional membership action, and the row's
 * own failure line. The action is the row's only chrome, so the eye lands on
 * the handle first and on the action second. A read-only roster omits it and
 * the trailing track collapses, handing its width back to the description.
 */
export declare function TeamMemberRow({ status, action, error, className, t }: {
    readonly status: AgentTeamClientMemberStatus;
    readonly action?: TeamMemberAction | undefined;
    /** Transport failure for this row's last mutation, announced in place. */
    readonly error?: string | undefined;
    /** Surface-local hook (dialog, sidebar, footer) for its own row rules. */
    readonly className?: string | undefined;
    readonly t: TeamSidebarProps['t'];
}): import("react").JSX.Element;
//# sourceMappingURL=TeamMemberRow.d.ts.map