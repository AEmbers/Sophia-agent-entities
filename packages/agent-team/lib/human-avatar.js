import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { ATTACHMENT_MAX_BYTES, sanitizeFileName, sanitizeMediaType } from "./attachments.js";
/**
 * Persistent human avatar store. Layout mirrors the composer attachment
 * cache (`<avatarRef>/` payload plus `meta.json`) but lives under its own
 * root with no TTL sweep: avatar bytes must survive longer than the 72h
 * referenced / 24h orphan windows that bound message attachments.
 */
export function humanAvatarsRoot() {
    return dshHomePath('agent-team', 'human', 'v1');
}
function avatarDir(root, avatarRef) {
    return join(root, avatarRef);
}
/** Accept only image payloads; the settings page sends `image/*` exclusively. */
export function assertAvatarMediaType(mediaType) {
    const sanitized = sanitizeMediaType(mediaType);
    if (!sanitized.startsWith('image/'))
        throw new Error(`human avatar must be an image (got '${mediaType}')`);
    return sanitized;
}
/** Write one avatar as an immutable entry; the caller stores the ref in settings. */
export async function writeHumanAvatar(root, rawName, mediaType, bytes) {
    if (bytes.byteLength === 0)
        throw new Error('human avatar must not be empty');
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES)
        throw new Error(`human avatar exceeds the ${ATTACHMENT_MAX_BYTES} byte limit`);
    const storedMediaType = assertAvatarMediaType(mediaType);
    const name = sanitizeFileName(rawName);
    const avatarRef = randomUUID();
    const dir = avatarDir(root, avatarRef);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ name, mediaType: storedMediaType, uploadedAt: new Date().toISOString() }), 'utf8');
    return { avatarRef, path: join(dir, name), name, byteSize: bytes.byteLength, mediaType: storedMediaType };
}
/** Read one avatar back; `undefined` when removed or never written. */
export async function readHumanAvatar(root, avatarRef) {
    const dir = avatarDir(root, avatarRef);
    let metaRaw;
    try {
        metaRaw = await readFile(join(dir, 'meta.json'));
    }
    catch {
        return undefined;
    }
    const meta = JSON.parse(metaRaw.toString('utf8'));
    const entries = await readdir(dir);
    const payload = entries.filter(entry => entry !== 'meta.json')[0];
    if (payload === undefined)
        return undefined;
    const bytes = await readFile(join(dir, payload));
    return { name: meta.name, mediaType: meta.mediaType, byteSize: bytes.byteLength, uploadedAt: meta.uploadedAt, bytes };
}
/** Remove one avatar entry; missing entries already satisfy the removal. */
export async function removeHumanAvatar(root, avatarRef) {
    await rm(avatarDir(root, avatarRef), { recursive: true, force: true });
}
