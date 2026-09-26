import type { AgentTeamAttachmentId, AgentTeamGetAttachmentRequest, AgentTeamGetAttachmentResult } from 'dsh-sophia-entities/types';
/** Base64 one file payload in chunks so large uploads stay off the call-stack limit. */
export declare function bytesToBase64(bytes: Uint8Array): string;
/** Mirrors the slot's Remote result union without importing the slots module. */
type GetAttachment = (request: AgentTeamGetAttachmentRequest) => Promise<{
    ok: true;
    value: AgentTeamGetAttachmentResult;
} | {
    ok: false;
    error: {
        message: string;
    };
}>;
export declare function cachedAttachmentDataUrl(attachmentId: AgentTeamAttachmentId): string | null | undefined;
export declare function loadAttachmentDataUrl(getAttachment: GetAttachment, attachment: {
    attachmentId: AgentTeamAttachmentId;
    mediaType: string;
}): Promise<string | null>;
/** Human-readable byte size for attachment chips. */
export declare function formatByteSize(byteSize: number): string;
export {};
//# sourceMappingURL=attachment-preview.d.ts.map