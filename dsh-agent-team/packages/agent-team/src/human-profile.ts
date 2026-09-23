import z from '@deepseek-ai/schemastery'

/**
 * Human identity profile: the one configurable display name plus the avatar
 * reference. `member:human` stays the durable identity everywhere; only the
 * handle shown in team_view, @ matching, and UI follows this profile.
 *
 * Storage split (see spec.md v1):
 * - name + avatarRef live in the Host settings namespace `agent-team-human`
 *   (settings.yaml user layer, live through `ctx.settings`).
 * - avatar bytes live under a persistent directory below; the settings
 *   document holds only the reference, never a data URL. The composer
 *   attachment cache is TTL-bound and must not hold avatar bytes.
 */

export const HUMAN_PROFILE_SETTINGS_NAMESPACE = 'agent-team-human'

/** Fallback display name before any user override is stored. */
export const HUMAN_PROFILE_DEFAULT_NAME = 'human'

/** Repository home for the version footnote link. */
export const HUMAN_PROFILE_REPO_URL = 'https://github.com/wowyuarm/dsh-agent-team'

/**
 * Bundle version shown in the settings footnote. Kept in sync with the root
 * package.json by hand until the Host build injects it; the footnote is
 * informational only and never gates behavior.
 */
export const HUMAN_PROFILE_VERSION = '0.1.13'

export interface HumanProfile {
  readonly name: string
  readonly avatarRef?: string
}

/** Settings document shape: name with schema default, avatarRef as a plain reference. */
export interface HumanProfileSettings {
  readonly name: string
  readonly avatarRef?: string
}

/** Schemastery schema resolving the `agent-team-human` namespace value. */
export const HUMAN_PROFILE_SETTINGS_SCHEMA: z<HumanProfileSettings> = z.object({
  name: z.string().default(HUMAN_PROFILE_DEFAULT_NAME),
  // Schemastery fields are optional unless `.required()`: a missing avatarRef
  // simply resolves absent, which the profile reads as "no custom avatar".
  avatarRef: z.string(),
})

/** Normalize one candidate display name the way Member handles normalize. */
export function normalizeHumanName(raw: string): string {
  return raw.normalize('NFKC').trim()
}

/**
 * Validate one candidate display name with the same floor as Member handles:
 * non-empty after trim. Uniqueness against live Members is checked by the
 * Host (which owns the ledger), not here, so this stays a pure function.
 */
export function assertValidHumanName(raw: string): string {
  const name = normalizeHumanName(raw)
  if (name === '') throw new Error('human name must not be empty')
  return name
}
