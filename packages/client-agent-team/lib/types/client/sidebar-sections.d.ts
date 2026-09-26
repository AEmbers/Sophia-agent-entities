import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
/** Which sidebar section a collapse state belongs to. */
export type TeamSidebarSectionKind = 'channels' | 'agents';
/**
 * Effective expanded state for one sidebar section: `false` only when this
 * browser explicitly collapsed it. Booleans are primitives, so the snapshot
 * is naturally identity-stable for `useSyncExternalStore`.
 */
export declare function useSidebarSectionOpen(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind): boolean;
/**
 * The only mutation path: record one section's expanded state for this
 * browser. Unknown keys (missing workspace) no-op so an unloaded workspace
 * never persists a phantom preference.
 */
export declare function setSidebarSectionOpen(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind, open: boolean): void;
//# sourceMappingURL=sidebar-sections.d.ts.map