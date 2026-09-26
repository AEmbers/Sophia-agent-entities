import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { AgentTeamAttachmentId, AgentTeamPutAttachmentRequest, AgentTeamPutAttachmentResult, AgentTeamRequestId } from 'dsh-sophia-entities/types';
/** Fresh idempotency identity for one Client-initiated durable request. */
export declare const mintRequestId: () => AgentTeamRequestId;
/**
 * Upload composer files in order. One failure stops with the error text; the
 * caller keeps its chips so a retry uploads only the still-pending files.
 */
export declare const uploadComposerFiles: (putAttachment: (request: AgentTeamPutAttachmentRequest) => Promise<RemoteResult<AgentTeamPutAttachmentResult>>, workspaceId: AgentTeamPutAttachmentRequest["workspaceId"], files: readonly File[]) => Promise<{
    ok: true;
    attachmentIds: readonly AgentTeamAttachmentId[];
} | {
    ok: false;
    error: string;
}>;
//# sourceMappingURL=requests.d.ts.map