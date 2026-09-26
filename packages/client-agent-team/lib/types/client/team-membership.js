import { useRef, useState } from 'react';
import { mintRequestId } from "./requests.js";
/**
 * Shared Channel membership mutation. One stable requestId per direction,
 * Member, and Channel survives transport failures until the Host commits it;
 * rows observe pending flags and error text keyed by `rowKeyOf`.
 */
export function useChannelMembership(transport, rowKeyOf, onCommitted) {
    const [pending, setPending] = useState(new Set());
    const [errors, setErrors] = useState(new Map());
    const requestIds = useRef(new Map());
    const change = async (membership) => {
        const rowKey = rowKeyOf(membership);
        if (pending.has(rowKey))
            return;
        setPending(current => new Set(current).add(rowKey));
        setErrors(current => { const next = new Map(current); next.delete(rowKey); return next; });
        const key = `${membership.joined ? 'remove' : 'join'}:${membership.memberId}:${membership.channelRef}`;
        const requestId = requestIds.current.get(key) ?? mintRequestId();
        requestIds.current.set(key, requestId);
        const request = { requestId, workspaceId: membership.workspaceId, channelRef: membership.channelRef, memberId: membership.memberId };
        try {
            const result = membership.joined ? await transport.removeChannelMember(request) : await transport.joinChannel(request);
            if (result.ok) {
                requestIds.current.delete(key);
                await onCommitted(membership);
            }
            else {
                setErrors(current => new Map(current).set(rowKey, result.error.message));
            }
        }
        catch (cause) {
            setErrors(current => new Map(current).set(rowKey, cause instanceof Error ? cause.message : String(cause)));
        }
        finally {
            setPending(current => { const next = new Set(current); next.delete(rowKey); return next; });
        }
    };
    return { pending, errors, change };
}
