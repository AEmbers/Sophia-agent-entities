import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
/** Which sidebar list an order belongs to; the two ledgers are independent. */
export type TeamSidebarListKind = 'channels' | 'agents';
/** Insert side of a drop relative to the row under the pointer. */
export type SidebarDropMarker = 'before' | 'after';
/**
 * Merge the saved personal order into the current Remote order: kept refs
 * stay in the user's relative order with duplicates collapsed, removed refs
 * disappear, and new refs join in their Remote default positions after the
 * known ones.
 */
export declare function reconcileSidebarOrder<R extends string>(saved: readonly string[], current: readonly R[]): readonly R[];
/**
 * Effective row order for one sidebar list: the user's saved order folded
 * into the given Remote default order. Identity-stable across renders while
 * neither the data nor this browser's preference changes.
 */
export declare function useSidebarOrder<R extends string>(workspaceId: WorkspaceId | undefined, kind: TeamSidebarListKind, refs: readonly R[]): readonly R[];
/**
 * The only mutation path: move `movedRef` to the given side of `targetRef`
 * inside the list's current effective order. Returns the new order, or
 * `undefined` when the request cannot change anything (unknown refs, dropping
 * a row onto itself, or an adjacent marker that would put it right back).
 * Persistence and subscriber notification happen here.
 */
export declare function moveSidebarItem<R extends string>(workspaceId: WorkspaceId | undefined, kind: TeamSidebarListKind, refs: readonly R[], movedRef: R, targetRef: R, marker: SidebarDropMarker): readonly R[] | undefined;
//# sourceMappingURL=sidebar-order.d.ts.map