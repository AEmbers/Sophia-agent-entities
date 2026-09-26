import { jsx as _jsx } from "react/jsx-runtime";
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { TeamStateDot } from "./TeamStateDot.js";
import css from './presence.module.css';
export function presenceLabel(status, t) {
    const label = status.presence === 'available' ? t('statusAvailable')
        : status.presence === 'working' ? t('statusWorking')
            : status.presence === 'error' ? t('statusError') : t('statusUnavailable');
    return status.diagnostic === undefined ? label : `${label}: ${diagnosticText(status)}`;
}
/** One line of human-readable diagnostic text: the reason, plus the refused artifact path when one was reported. */
export function diagnosticText(status) {
    const diagnostic = status.diagnostic;
    if (diagnostic === undefined)
        return '';
    return diagnostic.location === undefined ? diagnostic.detail : `${diagnostic.detail} (${diagnostic.location.path})`;
}
/**
 * Whether the restart action can help an unavailable Member: it heals
 * transient and repairable failures, but not a transient rollover window
 * (which resolves on its own) or a refusal already proven non-remediable.
 */
export function restartOffered(status) {
    const diagnostic = status.diagnostic;
    if (diagnostic === undefined)
        return true;
    if (diagnostic.class === 'rollover')
        return false;
    return !(diagnostic.class === 'session-refused' && diagnostic.remediable === false);
}
/** Shared presence → indicator mapping for dots and avatar badges. */
export function presenceDotState(presence) {
    return presence === 'available' ? 'done' : presence === 'working' ? 'ongoing' : presence === 'error' ? 'error' : 'quiet';
}
export function TeamPresenceDot({ status, t }) {
    const label = presenceLabel(status, t);
    return (_jsx(Tooltip, { label: label, delayMs: 300, children: _jsx("span", { className: css.target, role: "img", "aria-label": label, children: _jsx(TeamStateDot, { state: presenceDotState(status.presence) }) }) }));
}
