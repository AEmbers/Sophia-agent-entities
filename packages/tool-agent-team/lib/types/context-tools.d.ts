/**
 * Model-facing context-management tools for Team Members. Thin adapters
 * only: validation runs in the Host adapter, the successful result is the
 * durable intent, and every lifecycle side effect — generation swap, Session
 * creation, inbox handling — happens in the Host coordinator after the
 * result is durably appended. `concludeTurn()` rides the success result of
 * `context_rollover` and `context_checkpoint`, so sibling calls settle in model
 * order before the turn closes.
 * @module dsh-sophia-entities/context-tools
 */
export declare function registerContextTools(ctx: {
    readonly tools: {
        register(tool: unknown): void;
    };
}): void;
//# sourceMappingURL=context-tools.d.ts.map