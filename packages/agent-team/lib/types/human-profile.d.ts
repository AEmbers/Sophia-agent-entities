import z from '@deepseek-ai/schemastery';
/**
 * Human identity profile: the one configurable display name plus the avatar
 * reference. `member:human` stays the durable identity everywhere; only the
 * handle shown in team_view, @ matching, and UI follows this profile.
 *
 * Storage split (see spec.md v1):
 * - name + avatarRef are the Team Host row's own Config, so they live in the
 *   active profile's patch document as that row's `config` and the settings
 *   service derives their form from this schema. rc.1 derives every form from
 *   a plugin's Config, so the retired `installSection` namespace — a section of
 *   its own — has no counterpart; the row id below is the settings namespace.
 * - avatar bytes live under a persistent directory below; the profile holds
 *   only the reference, never a data URL. The composer attachment cache is
 *   TTL-bound and must not hold avatar bytes.
 */
/**
 * Settings namespace of the Human profile: the Team Host row's id in
 * `cordis.patch.yml`, which is what the settings service addresses a form and a
 * write by AND the id the profile-document write patches. It is addressed by
 * this constant, never by the running Host's `ctx.fiber.entry`: a Remote call
 * runs under its caller's context, so that lookup names the RPC gateway's row.
 * `shipping.spec.ts` pins the constant to the row the composition declares.
 */
export declare const HUMAN_PROFILE_SETTINGS_NAMESPACE = "sophia-entities-host";
/** Fallback display name before any user override is stored. */
export declare const HUMAN_PROFILE_DEFAULT_NAME = "human";
/** Repository home for the version footnote link. */
export declare const HUMAN_PROFILE_REPO_URL = "https://github.com/AEmbers/dsh-sophia-entities";
/**
 * Bundle version shown in the settings footnote, and the current side of the
 * update check: the version of the package THIS Host runs from — read from the
 * installed manifest, so a `link:` checkout under the development profile and a
 * registry tarball under stable each state their own truth. It is not a
 * hand-maintained string: the 0.1.14 bundle shipped with `0.1.13` written in
 * it, which made the footnote name the previous release and the update check
 * offer the release the user already had.
 *
 * Resolved once at load, three levels above this module — `packages/agent-team/{src,lib}`
 * sits that deep in both layouts, the same relative positioning
 * `member-runtime.ts` uses to find `core-skills`. An unreadable or malformed
 * manifest degrades to `'unknown'`: the Remote's `version: string` contract
 * holds and the update comparison simply compares nothing. The footnote is
 * informational only and never gates behavior.
 */
export declare const HUMAN_PROFILE_VERSION: string;
export interface HumanProfile {
    readonly name: string;
    readonly avatarRef?: string;
}
/** Settings document shape: name with schema default, avatarRef as a plain reference. */
export interface HumanProfileSettings {
    readonly name: string;
    readonly avatarRef?: string;
}
/**
 * Schemastery schema of the Human profile: the Team Host row's Config. Both
 * fields are volatile, which is what lets an edit reach the running Host
 * without remounting it — and what makes the settings service derive a form
 * from this schema at all.
 */
export declare const HUMAN_PROFILE_SETTINGS_SCHEMA: z<Schemastery.ObjectS<NoInfer<{
    name: z<string, string, "volatile-defined">;
    avatarRef: z<string, string, "volatile">;
}>>, Schemastery.ObjectT<NoInfer<{
    name: z<string, string, "volatile-defined">;
    avatarRef: z<string, string, "volatile">;
}>>, "plain">;
/** Normalize one candidate display name the way Member handles normalize. */
export declare function normalizeHumanName(raw: string): string;
/**
 * Validate one candidate display name with the same floor as Member handles:
 * non-empty after trim. Uniqueness against live Members is checked by the
 * Host (which owns the ledger), not here, so this stays a pure function.
 */
export declare function assertValidHumanName(raw: string): string;
/**
 * The retired settings section this profile's facts lived in before rc.1.
 * rc.1 derives every settings form from a plugin's Config, and its legacy
 * `settings.yaml` importer maps a section to a composition entry id through a
 * closed built-in list — this third-party section matches nothing there, so
 * the import rejects it and the values survive only in the renamed document.
 * This Host owns the section, so adopting what is left belongs here.
 */
export declare const LEGACY_HUMAN_PROFILE_SECTION = "agent-team-human";
/** Fields recoverable from the legacy section; either may be absent. */
export interface LegacyHumanProfileFields {
    readonly name?: string;
    readonly avatarRef?: string;
}
/**
 * Read the legacy section out of one legacy settings document. An
 * unparsable document or a missing section means "nothing to adopt" rather
 * than an error — the file is retired input, not an authority — and each
 * field is validated independently so one bad field never costs the other.
 */
export declare function parseLegacyHumanProfile(yamlText: string): LegacyHumanProfileFields | undefined;
/**
 * Decide what adoption may write: nothing unless the stored profile is still
 * the pristine default, so a value the Human re-entered after the upgrade
 * always wins, and never the legacy default name itself. The current profile
 * carries explicit `undefined` on `avatarRef` — the Host getter spreads a
 * settings read — and so is not `HumanProfile` under
 * exactOptionalPropertyTypes; taking that shape directly keeps the Host call
 * cast-free. The returned fields are exactly the ops the profile page would
 * have written; byte existence for `avatarRef` is the caller's I/O and must
 * already hold.
 */
export declare function planLegacyAdoption(current: {
    readonly name: string;
    readonly avatarRef?: string | undefined;
}, legacy: LegacyHumanProfileFields): {
    readonly name?: string;
    readonly avatarRef?: string;
} | undefined;
//# sourceMappingURL=human-profile.d.ts.map