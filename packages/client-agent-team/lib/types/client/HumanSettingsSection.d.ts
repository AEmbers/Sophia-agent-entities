import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type TeamHumanIdentityFace } from './human-identity.ts';
export interface HumanSettingsSectionInjected {
    /** The shared Human identity projection: profile facts plus post-write refresh. */
    identity: TeamHumanIdentityFace;
    /** Persist one renamed display name; the failure message when the Host refuses it. */
    saveName: (name: string) => Promise<string | undefined>;
    /** Upload one image file, persist its reference; the failure message when it does not stick. */
    uploadAvatar: (file: File) => Promise<string | undefined>;
    /** Clear the avatar; the identity falls back to the initial. */
    removeAvatar: () => Promise<string | undefined>;
}
export type HumanSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'team'> & HumanSettingsSectionInjected;
export declare function HumanSettingsSection(props: HumanSettingsSectionProps): import("react").JSX.Element;
//# sourceMappingURL=HumanSettingsSection.d.ts.map