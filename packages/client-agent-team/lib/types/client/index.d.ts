import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { TeamNavigation } from './navigation.ts';
import { TeamDraftStore } from './drafts.ts';
import { type TeamKey } from './locales.ts';
export type { TeamMode, TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts';
export type { TeamKey } from './locales.ts';
export { TeamNavigation } from './navigation.ts';
/**
 * Union of both halves' service requirements. The module activates only once
 * every name here is available, so the DAG half's services (uiConversation,
 * modelDirectories, layout) gate the Team half too — intentional: a missing
 * service would otherwise crash a slot at render time instead of parking the
 * plugin, which is exactly the failure mode that silently erased the UI before.
 */
export declare const inject: string[];
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        team: TeamKey;
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        teamNavigation: TeamNavigation;
        teamDrafts: TeamDraftStore;
    }
}
export declare function apply(ctx: ClientContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map