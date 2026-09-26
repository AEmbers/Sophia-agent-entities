import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './sidebar.module.css';
/** Collapsible sidebar section header: disclosure toggle plus trailing actions. */
export function TeamSidebarSection({ title, actions, open, onToggle, children }) {
    return (_jsxs("section", { className: css.section, children: [_jsxs("div", { className: css.sectionHeader, children: [_jsxs("button", { type: "button", className: css.sectionToggle, "aria-expanded": open, onClick: () => { onToggle(!open); }, children: [_jsx(IconChevronDownOutlineRegular, { className: css.sectionChevron }), _jsx("span", { className: css.sectionTitle, children: title })] }), actions !== undefined && _jsx("span", { className: css.sectionActions, children: actions })] }), open && children] }));
}
