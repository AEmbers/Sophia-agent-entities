import type { AgentTeamClientMemberStatus, AgentTeamModelSelection } from 'dsh-sophia-entities/types';
import type { TeamSidebarProps } from './slots.ts';
/**
 * Best-effort warm of the shared catalog (the agents panel calls this while
 * the roster loads, so the pickers open with rows instead of paying the
 * first read on open). Failures belong to the picker's own error surface.
 */
export declare function warmModelCatalog(loadModels: TeamSidebarProps['loadModels']): void;
/**
 * Shared provider/model dropdown for the create and edit forms. The option
 * list rides the shared Menu primitive (one leading "follow Host default"
 * row, then non-selectable provider headings) with a capped, internally
 * scrolling card so growing model catalogs cannot stretch the dialog. Mounts
 * open with the warmed value when one exists and revalidate behind it, so a
 * slow Host read delays a refresh — never the picker itself; a refused or
 * failed read with no warmed value renders a retryable error instead of
 * stranding the field on "loading".
 */
export declare function ModelPickerField({ model, onModelChange, loadModels, disabled, t }: {
    readonly model: AgentTeamModelSelection | undefined;
    readonly onModelChange: (choice: AgentTeamModelSelection | undefined) => void;
    readonly loadModels: TeamSidebarProps['loadModels'];
    readonly disabled: boolean;
    readonly t: TeamSidebarProps['t'];
}): import("react").JSX.Element;
/**
 * Agent editor: handle, description, and per-Member model selection commit
 * through one durable update. Channel membership is managed from the Channel
 * side, not here.
 */
export declare function AgentEditorDialog({ status, updateMember, loadModels, onCommitted, onClose, t }: {
    readonly status: AgentTeamClientMemberStatus;
    readonly updateMember: TeamSidebarProps['updateMember'];
    readonly loadModels: TeamSidebarProps['loadModels'];
    readonly onCommitted: () => Promise<void> | void;
    readonly onClose: () => void;
    readonly t: TeamSidebarProps['t'];
}): import("react").JSX.Element;
export declare function sameModel(left: AgentTeamModelSelection | undefined, right: AgentTeamModelSelection | undefined): boolean;
//# sourceMappingURL=TeamMemberEditor.d.ts.map