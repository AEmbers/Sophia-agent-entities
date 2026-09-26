import type { AgentTeamAttachmentId } from './types.ts';
/**
 * Composer attachments are a cache, not an archive: bytes live only so Member
 * agents can read them within the consumption window, while the ledger keeps
 * the metadata forever. Everything here derives from the on-disk layout
 * `$DSH_HOME/agent-team/attachments/v1/<attachmentId>/` holding the payload
 * file (original sanitized name) plus a `meta.json` sidecar.
 */
export declare const ATTACHMENT_MAX_BYTES: number;
/** Referenced uploads survive this long after upload for member consumption. */
export declare const ATTACHMENT_REFERENCED_TTL_MS: number;
/** Unreferenced uploads (uploaded but never sent) are cleaned much sooner. */
export declare const ATTACHMENT_ORPHAN_TTL_MS: number;
export declare function attachmentsRoot(): string;
/** Absolute payload path of one stored attachment, as offered to Member agents. */
export declare function attachmentPayloadPath(attachmentId: AgentTeamAttachmentId, name: string): string;
export declare function newAttachmentId(): AgentTeamAttachmentId;
/** Strip path separators, control characters, Windows-illegal characters, reserved device names, and leading dots from one client-supplied name. */
export declare function sanitizeFileName(raw: string): string;
/** Best-effort media type from one path's extension, so images render as thumbnails. */
export declare function mediaTypeForPath(raw: string): string;
/**
 * Validate one agent-supplied attachment path before any cache write happens,
 * so a rejection anywhere leaves the upload cache untouched.
 */
export declare function validatePathAttachment(raw: string): Promise<void>;
/** Copy one validated file into the cache as a fresh immutable entry. */
export declare function copyPathAttachment(root: string, raw: string): Promise<{
    attachmentId: AgentTeamAttachmentId;
    name: string;
    byteSize: number;
    mediaType: string;
}>;
/** Write one upload as an immutable payload plus its metadata sidecar. */
export declare function writeAttachment(root: string, attachmentId: AgentTeamAttachmentId, rawName: string, mediaType: string, bytes: Buffer): Promise<{
    attachmentId: AgentTeamAttachmentId;
    path: string;
    name: string;
    byteSize: number;
    mediaType: string;
}>;
export interface StoredAttachment {
    readonly name: string;
    readonly mediaType: string;
    readonly byteSize: number;
    readonly uploadedAt: string;
    readonly bytes: Buffer;
}
/** Read one attachment back; `undefined` when the cache entry is gone (GC'd). */
export declare function readAttachment(root: string, attachmentId: AgentTeamAttachmentId): Promise<StoredAttachment | undefined>;
export interface CacheEntryScan {
    readonly attachmentId: AgentTeamAttachmentId;
    readonly uploadedAt: number;
}
/** List every cache entry with its upload instant for the GC sweep. */
export declare function scanAttachmentCache(root: string): Promise<readonly CacheEntryScan[]>;
/** Remove one cache entry's bytes; missing entries already satisfy the sweep. */
export declare function removeAttachment(root: string, attachmentId: AgentTeamAttachmentId): Promise<void>;
/** Ids of uploads a Message still references — everything else is an orphan. */
export type ReferencedAttachments = ReadonlySet<AgentTeamAttachmentId>;
/**
 * One GC pass: drop uploads older than the orphan TTL, and referenced ones
 * older than the consumption-window TTL. Returns the ids removed so the
 * service can log them.
 */
export declare function sweepAttachmentCache(root: string, referenced: ReferencedAttachments, now: number): Promise<readonly AgentTeamAttachmentId[]>;
/** Accept only well-formed `type/subtype` media types; anything else falls back to the generic binary type. */
export declare function sanitizeMediaType(raw?: string | undefined): string;
//# sourceMappingURL=attachments.d.ts.map