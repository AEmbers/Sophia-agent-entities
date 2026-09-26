import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
/** One selectable Workspace, in the order the Workspace list already carries. */
export interface TeamWorkspaceChoice {
    readonly workspaceId: WorkspaceId;
    readonly title: string;
    readonly path: string;
}
/**
 * The single-line Workspace selector that scopes the Team sidebar.
 *
 * The sections below it — Channels and Agents — belong to exactly one
 * Workspace, so a flat list of every Workspace above them states a global
 * scope over local content. Collapsing that list into one selector makes the
 * sidebar read as "you are in X, and here is X's content", and returns the
 * rows a low-frequency switch was holding. Nothing is hidden by the collapse:
 * Workspace rows carry no unread mark of their own, and cross-Workspace unread
 * is summarized by the Inbox entry above — the one destination that outlives
 * this scope, which is why it stays outside the selector's reach.
 *
 * The trigger is a field rather than a row: the line that states where the
 * reader is must not read as the first entry of the Channels list below it,
 * and its accessible name states the Workspace it is showing, because that
 * value is otherwise unavailable to a reader who cannot see the field. The
 * menu is the only way to switch Workspaces, so it takes focus on open and
 * hands it back to the trigger on Escape.
 */
export declare function TeamWorkspaceSelector({ workspaces, selectedId, current, onSelect, t }: {
    readonly workspaces: readonly TeamWorkspaceChoice[];
    readonly selectedId: WorkspaceId | undefined;
    /** The Team center shows the selected Workspace's overview (no Channel is open). */
    readonly current: boolean;
    readonly onSelect: (workspaceId: WorkspaceId) => void;
    readonly t: (key: 'empty' | 'workspaceSelectorWithValue', params?: {
        title: string;
    }) => string;
}): import("react").JSX.Element;
//# sourceMappingURL=TeamWorkspaceSelector.d.ts.map