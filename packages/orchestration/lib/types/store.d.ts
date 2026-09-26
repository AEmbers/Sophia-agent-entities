import type { ApprovalRequest } from './types.ts';
export declare function teamLockQueueKeys(): string[];
export declare function withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
/** Resolve the approvals root for a workspace. */
export declare function approvalsRootOf(workspace: string): string;
export declare function approvalFileOf(root: string, requestId: string): string;
/** Read one request; `undefined` when absent or malformed remnants exist. */
export declare function readApproval(root: string, requestId: string): Promise<ApprovalRequest | undefined>;
/** Read every pending (non-terminal) request, newest first. */
export declare function listApprovals(root: string): Promise<ApprovalRequest[]>;
/** Persist one request atomically. */
export declare function writeApproval(root: string, request: ApprovalRequest): Promise<void>;
/** Remove a request file (ENOENT is fine). */
export declare function deleteApproval(root: string, requestId: string): Promise<void>;
/** Short stable id derived from a goal, used for hash dedupe (§4.8 point 4). */
export declare function goalDigest(goal: string): string;
//# sourceMappingURL=store.d.ts.map