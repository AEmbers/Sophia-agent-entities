import type { TeamConversationProps } from './slots.ts';
interface TeamInboxPageProps {
    readonly useWorkspaces: TeamConversationProps['useWorkspaces'];
    readonly loadInbox: TeamConversationProps['loadInbox'];
    /** Wake source while the page is open: one scope-less subscription, shared with the badge poll. */
    readonly subscribeChanges: TeamConversationProps['subscribeChanges'];
    readonly selectWorkspace: TeamConversationProps['selectWorkspace'];
    readonly selectThread: TeamConversationProps['selectThread'];
    /** The Human's display name, from the Client's one identity projection. */
    readonly humanName: string;
    readonly humanAvatarUrl?: string | undefined;
    readonly t: TeamConversationProps['t'];
}
/**
 * The Human Inbox: one Inbox call per visible Workspace, rendering the Host's
 * two slices — the unread queue (「需要我」, mentions counted inside it rather
 * than alone) and the 「最近活跃」 tail of Threads the reader took part in.
 * Both merge across every Workspace into one list in the Host's own order,
 * mentions first and then newest, rather than by Workspace.
 * Opening the page never acknowledges anything — only a durable Thread read
 * advances the watermark and consumes a mention marker, so rows and the badge
 * drop after the Thread is opened through the existing auto-ack path. A Thread
 * holding unread is only ever in the queue: the Host already excludes it from
 * the tail, and this page never re-derives that judgement.
 */
export declare function TeamInboxPage({ useWorkspaces, loadInbox, subscribeChanges, selectWorkspace, selectThread, humanName, humanAvatarUrl, t }: TeamInboxPageProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TeamInboxPage.d.ts.map