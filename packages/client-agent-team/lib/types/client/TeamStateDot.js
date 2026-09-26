import { jsx as _jsx } from "react/jsx-runtime";
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './state-dot.module.css';
/**
 * Render the one shared Team status indicator. Native StateDot states pass
 * through; the quiet statuses mirror StateDot geometry locally so every
 * surface renders the same shape — todo a hollow ring (not started), quiet a
 * solid tertiary dot with the same 10% halo (closed, unavailable).
 */
export function TeamStateDot({ state, size = 10 }) {
    if (state === 'todo' || state === 'quiet') {
        return _jsx("span", { className: css.quiet, "data-variant": state, style: { width: size, height: size }, "aria-hidden": "true" });
    }
    return _jsx(StateDot, { state: state, size: size });
}
