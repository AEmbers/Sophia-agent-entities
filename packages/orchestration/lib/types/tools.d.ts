import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { SophiaTeamFacade, CallerIdentity } from './facade.ts';
/** How the host turns a tool execution into a caller identity. */
export interface ApprovalToolDependencies {
    facade: SophiaTeamFacade;
    /** Derive who is calling from the tool execution context. */
    resolveCaller(exec: ToolRunContext): Promise<CallerIdentity>;
}
export interface ApprovalToolSet {
    propose: unknown;
    review: unknown;
    approve: unknown;
}
/**
 * Register the three approval tools on a cordis context.
 * @returns the three definitions, for tool-surface composition (member tool
 *          filters include only `propose`, design §4.3.3).
 */
export declare function registerApprovalTools(ctx: {
    tools: {
        register(tool: unknown): void;
    };
}, dependencies: ApprovalToolDependencies): ApprovalToolSet;
//# sourceMappingURL=tools.d.ts.map