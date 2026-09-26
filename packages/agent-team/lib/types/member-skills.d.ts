/**
 * Per-Member private skill provider: the Team-owned wrapper around the
 * Harness filesystem provider that scopes one Member's skill discovery to
 * exactly the plugin's bundled read-only core skills plus that Member's
 * private `skills/` directory (default roots excluded), and filters `list()`
 * output by that Member's selection ref.
 *
 * Deliberate interface reservation: this per-Member provider seam is the
 * primitive future Runtime Revision manifests orchestrate — do not remove
 * during cleanup.
 *
 * @module dsh-sophia-entities/member-skills
 */
import type { Context } from '@deepseek-ai/cordis';
/** Live selection state shared with the Host: `undefined` loads every discovered skill. */
export type MemberSkillSelectionRef = {
    current: readonly string[] | undefined;
    /** Set by the provider; swaps the selection and invalidates the catalog cache. */
    swap: (allow: readonly string[] | undefined) => void;
};
/** Per-Member provider configuration; the private directory is provisioned before mounting. */
export interface MemberSkillsConfig {
    /** The Member's private skills directory; the writable self-install root. */
    readonly skillsDirectory: string;
    /** Read-only bundled skills shipped with the plugin (e.g. the meta skill). */
    readonly bundledSkillsDirectory: string | undefined;
    /** Live selection ref; an edit swaps the array and invalidates the catalog. */
    readonly selection: MemberSkillSelectionRef;
}
/**
 * Register the Member-private skill provider on one Member's agent scope and
 * return its disposer. The provider files into that agent's exact layer, so
 * no sibling Member or ordinary session can observe the catalog; discovery,
 * watching, and invalidation flow through the same Harness provider below.
 *
 * Registration goes through the traceable service resolved FROM the agent
 * context (the same shape as `tools.restrict()`), never through a plugin
 * mount: a plugin mounted from Host activation code lands on the Host's
 * async-trace fiber instead of the agent scope, and a plugin `inject` would
 * hold Member activation open while the Host is still starting. A deployment
 * without the skill registry keeps its Members; they simply carry no private
 * skill catalog.
 */
export declare function mountMemberSkillProvider(agentCtx: Context, config: MemberSkillsConfig): () => void;
//# sourceMappingURL=member-skills.d.ts.map