/** Package-owned invariant companion for `dsh-sophia-entities`. */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "agent-team-invariant";
/** Services required before the companion can validate Team state. */
export declare const inject: string[];
/**
 * Register the Agent Team ledger invariant.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the installed registration disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map