/**
 * Persistent human avatar store. Layout mirrors the composer attachment
 * cache (`<avatarRef>/` payload plus `meta.json`) but lives under its own
 * root with no TTL sweep: avatar bytes must survive longer than the 72h
 * referenced / 24h orphan windows that bound message attachments.
 */
export declare function humanAvatarsRoot(): string;
export interface StoredHumanAvatar {
    readonly name: string;
    readonly mediaType: string;
    readonly byteSize: number;
    readonly uploadedAt: string;
    readonly bytes: Buffer;
}
/** Accept only image payloads; the settings page sends `image/*` exclusively. */
export declare function assertAvatarMediaType(mediaType: string): string;
/** Write one avatar as an immutable entry; the caller stores the ref in settings. */
export declare function writeHumanAvatar(root: string, rawName: string, mediaType: string, bytes: Buffer): Promise<{
    avatarRef: string;
    path: string;
    name: string;
    byteSize: number;
    mediaType: string;
}>;
/** Read one avatar back; `undefined` when removed or never written. */
export declare function readHumanAvatar(root: string, avatarRef: string): Promise<StoredHumanAvatar | undefined>;
/** Remove one avatar entry; missing entries already satisfy the removal. */
export declare function removeHumanAvatar(root: string, avatarRef: string): Promise<void>;
//# sourceMappingURL=human-avatar.d.ts.map