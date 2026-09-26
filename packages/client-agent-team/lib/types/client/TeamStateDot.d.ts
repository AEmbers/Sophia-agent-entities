import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives';
/** The Team status dot language: the DSH four-color states plus the two quiet statuses StateDot has no slot for. */
export type TeamStateDotState = StateDotState | 'todo' | 'quiet';
/**
 * Render the one shared Team status indicator. Native StateDot states pass
 * through; the quiet statuses mirror StateDot geometry locally so every
 * surface renders the same shape — todo a hollow ring (not started), quiet a
 * solid tertiary dot with the same 10% halo (closed, unavailable).
 */
export declare function TeamStateDot({ state, size }: {
    readonly state: TeamStateDotState;
    readonly size?: number | undefined;
}): import("react").JSX.Element;
//# sourceMappingURL=TeamStateDot.d.ts.map