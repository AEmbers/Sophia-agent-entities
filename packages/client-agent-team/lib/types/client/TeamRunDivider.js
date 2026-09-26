import { jsx as _jsx } from "react/jsx-runtime";
import { formatMessageTime } from "./team-formatters.js";
import css from './conversation.module.css';
/**
 * Explicit boundary between two same-sender Messages of one run separated by
 * a real waiting gap: the hairline restores the block boundary that grouping
 * removed, and the label below it restores the instant that the suppressed
 * identity chrome would have shown.
 */
export function TeamRunDivider({ occurredAt }) {
    return (_jsx("div", { className: css.runDivider, role: "separator", children: _jsx("time", { dateTime: occurredAt, children: formatMessageTime(occurredAt) }) }));
}
