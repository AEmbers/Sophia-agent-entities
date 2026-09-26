import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { IconUserOutlineRegular, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { TeamMemberRow } from "./TeamMemberRow.js";
import membersCss from './members.module.css';
import css from './team.module.css';
export function TeamMembersAction({ wide, loadMemberGroups, t }) {
    const [panelOpen, setPanelOpen] = useState(false);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState();
    const triggerRef = useRef(null);
    const contentRef = useRef(null);
    useEffect(() => {
        if (!panelOpen)
            return;
        queueMicrotask(() => { contentRef.current?.focus(); });
    }, [panelOpen]);
    const openMembers = () => {
        setPanelOpen(true);
        setLoading(true);
        setError(undefined);
        void loadMemberGroups().then(setGroups).catch(cause => {
            setError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => { setLoading(false); });
    };
    const closeMembers = () => {
        setPanelOpen(false);
        queueMicrotask(() => { triggerRef.current?.focus(); });
    };
    return (_jsxs(_Fragment, { children: [_jsx(Tooltip, { label: t('members'), delayMs: 500, disabled: wide, children: _jsxs("button", { ref: triggerRef, type: "button", className: wide ? css.settingsAction : `${css.settingsAction} ${css.rail}`, "aria-label": t('members'), "aria-haspopup": "dialog", onClick: openMembers, children: [_jsx(IconUserOutlineRegular, { size: wide ? 16 : 18 }), wide && _jsx("span", { children: t('members') })] }) }), _jsx(Modal, { open: panelOpen, onClose: closeMembers, title: t('members'), closeLabel: t('close'), contentClassName: membersCss.body, children: _jsxs("div", { ref: contentRef, className: membersCss.content, tabIndex: -1, children: [loading && _jsx("p", { className: membersCss.state, role: "status", children: t('loadingAgents') }), !loading && groups.length === 0 && error === undefined && _jsx("p", { className: membersCss.state, children: t('emptyAgents') }), !loading && groups.map(group => (_jsxs("section", { className: membersCss.group, "aria-labelledby": `team-members-${group.workspaceId}`, children: [_jsx("h3", { id: `team-members-${group.workspaceId}`, children: group.workspaceTitle }), group.members.map(status => _jsx(TeamMemberRow, { status: status, className: membersCss.member, t: t }, status.member.memberId))] }, group.workspaceId))), error !== undefined && _jsx("p", { className: membersCss.error, role: "alert", children: error })] }) })] }));
}
