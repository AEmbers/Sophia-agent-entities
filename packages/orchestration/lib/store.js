/**
 * Approval queue persistence (design §4.1.2).
 *
 * Storage: `<workspace>/.sophia-entities/approvals/<requestId>.json` — a
 * sibling of both backends' state directories, kept deliberately independent:
 * the approval queue is the durable truth of the orchestration plane and
 * upgrades/downgrades never cross backend transactionally.
 *
 * The atomic-write + per-key lock pattern mirrors the teams backend's own
 * state.ts primitives (kept here as a dependency-free copy, per design §4.1.2
 * "该模块可直接复用，零依赖").
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Process-local per-key FIFO lock, mirroring teams state.ts `withTeamLock`. */
const locks = new Map();
export function teamLockQueueKeys() {
    return [...locks.keys()];
}
export async function withLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    locks.set(key, previous.then(() => current));
    await previous;
    try {
        return await fn();
    }
    finally {
        release();
        if (locks.get(key) === previous.then(() => current)) {
            locks.delete(key);
        }
    }
}
/** Windows rename can transiently fail with EPERM; retry a bounded number of times. */
const ATOMIC_RENAME_RETRIES = 3;
const ATOMIC_RENAME_RETRY_DELAY_MS = 50;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isRetryableRenameError(error) {
    return error instanceof Error
        && typeof error.code === 'string'
        && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
}
async function atomicWriteText(file, content) {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    for (let attempt = 0;; attempt += 1) {
        try {
            await rename(temporary, file);
            return;
        }
        catch (error) {
            if (!isRetryableRenameError(error) || attempt >= ATOMIC_RENAME_RETRIES) {
                // Last resort: overwrite in place (the tmp survives for manual repair).
                try {
                    await writeFile(file, content, { encoding: 'utf8' });
                    await unlink(temporary).catch(() => undefined);
                    return;
                }
                catch {
                    throw error;
                }
            }
            await sleep(ATOMIC_RENAME_RETRY_DELAY_MS);
        }
    }
}
/** Resolve the approvals root for a workspace. */
export function approvalsRootOf(workspace) {
    return join(workspace, '.sophia-entities', 'approvals');
}
export function approvalFileOf(root, requestId) {
    return join(root, `${requestId}.json`);
}
/** Directory that holds the request files; created lazily on first save. */
async function ensureApprovalsRoot(root) {
    await mkdir(root, { recursive: true });
}
function parseRequest(content) {
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('approval request is not a JSON object');
    }
    return parsed;
}
/** Read one request; `undefined` when absent or malformed remnants exist. */
export async function readApproval(root, requestId) {
    try {
        const content = await readFile(approvalFileOf(root, requestId), { encoding: 'utf8' });
        return parseRequest(content);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
/** Read every pending (non-terminal) request, newest first. */
export async function listApprovals(root) {
    let files;
    try {
        files = await readdir(root);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const requests = [];
    for (const file of files) {
        if (!file.endsWith('.json'))
            continue;
        const request = await readApproval(root, file.slice(0, -'.json'.length));
        if (request)
            requests.push(request);
    }
    return requests.sort((a, b) => b.createdAt - a.createdAt);
}
/** Persist one request atomically. */
export async function writeApproval(root, request) {
    await ensureApprovalsRoot(root);
    await atomicWriteText(approvalFileOf(root, request.id), `${JSON.stringify(request, null, 2)}\n`);
}
/** Remove a request file (ENOENT is fine). */
export async function deleteApproval(root, requestId) {
    try {
        await unlink(approvalFileOf(root, requestId));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
/** Short stable id derived from a goal, used for hash dedupe (§4.8 point 4). */
export function goalDigest(goal) {
    return createHash('sha256').update(goal).digest('hex').slice(0, 8);
}
