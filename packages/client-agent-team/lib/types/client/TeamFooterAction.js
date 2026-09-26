import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { IconAgentPresetOutlineRegular, IconChevronLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './team.module.css';
export function TeamFooterAction({ wide, navigation, enterTeam, leaveTeam, t }) {
    const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot);
    const inTeam = state.mode === 'team';
    const label = inTeam ? t('backToConversations') : t('team');
    useLayoutEffect(() => {
        if (typeof document === 'undefined')
            return;
        if (inTeam) {
            document.documentElement.dataset.agentTeamMode = 'team';
            return () => { delete document.documentElement.dataset.agentTeamMode; };
        }
        delete document.documentElement.dataset.agentTeamMode;
    }, [inTeam]);
    return (_jsx(_Fragment, { children: _jsx("div", { className: wide ? css.footerStack : `${css.footerStack} ${css.railStack}`, children: _jsx(Tooltip, { label: label, delayMs: 500, disabled: wide, children: _jsxs("button", { type: "button", className: wide ? css.footerAction : `${css.footerAction} ${css.rail}`, "aria-label": label, "data-team-action": inTeam ? 'leave' : 'enter', onClick: inTeam ? leaveTeam : enterTeam, children: [inTeam ? _jsx(IconChevronLeftOutlineRegular, { size: wide ? 16 : 18 }) : _jsx(IconAgentPresetOutlineRegular, { size: wide ? 16 : 18 }), wide && _jsx("span", { children: label })] }) }) }) }));
}
