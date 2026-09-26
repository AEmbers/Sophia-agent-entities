import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { TeamMemberAvatar } from "./TeamMemberAvatar.js";
import css from './member-row.module.css';
/**
 * The one place a Member's identity is drawn: the presence-bearing avatar plus
 * the handle over its description. Read-only rosters, the rosters with a
 * membership action, and the sidebar Agent list all render this, so identity,
 * tone and truncation cannot drift between surfaces that show the same person.
 *
 * A fragment, not a row: each surface owns its own row element, hit target and
 * grid, and places this identity in that grid's first two tracks. The handle
 * spelling is the surface's call — rosters address Members the way the
 * composer does (`@handle`), the sidebar names them as the directory does.
 */
export function TeamMemberIdentity({ status, name, className, t }) {
    return _jsxs(_Fragment, { children: [_jsx(TeamMemberAvatar, { status: status, t: t }), _jsxs("span", { className: className === undefined ? css.copy : `${css.copy} ${className}`, children: [_jsx("strong", { children: name ?? `@${status.member.handle.replace(/^@/, '')}` }), _jsx("small", { children: status.member.description })] })] });
}
/**
 * The one roster row: identity, an optional membership action, and the row's
 * own failure line. The action is the row's only chrome, so the eye lands on
 * the handle first and on the action second. A read-only roster omits it and
 * the trailing track collapses, handing its width back to the description.
 */
export function TeamMemberRow({ status, action, error, className, t }) {
    return _jsxs("div", { className: className === undefined ? css.row : `${css.row} ${className}`, "data-team-member-row": true, children: [_jsx(TeamMemberIdentity, { status: status, t: t }), action !== undefined && _jsx(Button, { size: "sm", variant: "outline", className: css.action, disabled: action.disabled === true, onClick: action.onSelect, children: action.label }), error !== undefined && _jsx("p", { className: css.error, role: "alert", children: error })] });
}
