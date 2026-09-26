import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { TeamMemberRow } from "./TeamMemberRow.js";
import { mintRequestId } from "./requests.js";
import css from './create.module.css';
/** Selection is a Host join, not a new Agent or a copied Session. */
export function TeamAgentImport({ workspaceId, loadMembers, joinWorkspace, onJoined, onPending, t }) {
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState();
    const [pending, setPending] = useState();
    const retry = useRef();
    const busy = useRef(false);
    const generation = useRef(0);
    const load = useCallback(async () => {
        const current = ++generation.current;
        setLoading(true);
        setError(undefined);
        try {
            const result = await loadMembers({});
            if (current !== generation.current)
                return;
            if (!result.ok)
                throw new Error(result.error.message);
            setMembers(result.value.filter(status => (status.member.state === 'enabled' || status.member.state === 'suspended') && !status.workspaceIds.includes(workspaceId)));
        }
        catch (cause) {
            if (current === generation.current)
                setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            if (current === generation.current)
                setLoading(false);
        }
    }, [loadMembers, workspaceId]);
    useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
    const join = async (status) => {
        if (busy.current)
            return;
        busy.current = true;
        setPending(status.member.memberId);
        onPending(true);
        setError(undefined);
        const request = retry.current?.memberId === status.member.memberId ? retry.current : {
            requestId: mintRequestId(), workspaceId, memberId: status.member.memberId,
        };
        retry.current = request;
        try {
            const result = await joinWorkspace(request);
            if (!result.ok)
                throw new Error(result.error.message);
            await onJoined();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            busy.current = false;
            setPending(undefined);
            onPending(false);
        }
    };
    return _jsxs("div", { className: css.form, children: [_jsx("p", { className: css.notice, children: t('importAgentNotice') }), loading && _jsx("p", { className: css.state, role: "status", children: t('loadingAgents') }), !loading && error === undefined && members.length === 0 && _jsx("p", { className: css.state, children: t('emptyImportAgents') }), !loading && members.length > 0 && _jsx("div", { className: css.roster, children: members.map(status => _jsx(TeamMemberRow, { status: status, t: t, action: {
                        label: pending === status.member.memberId ? t('importingAgent') : t('importAgent'),
                        disabled: pending !== undefined,
                        onSelect: () => { void join(status); },
                    } }, status.member.memberId)) }), error !== undefined && _jsxs("div", { className: css.failure, role: "alert", children: [_jsx("p", { className: css.error, children: error }), _jsx(Button, { disabled: pending !== undefined, variant: "outline", onClick: () => { void load(); }, children: t('retry') })] })] });
}
