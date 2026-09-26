import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSyncExternalStore } from 'react';
import { useHumanIdentity } from "./human-identity.js";
import { TeamChannelPage } from "./TeamChannelPage.js";
import { TeamInboxPage } from "./TeamInboxPage.js";
import { TeamThreadPage } from "./TeamThreadPage.js";
import css from './conversation.module.css';
export function TeamConversation({ t, useWorkspaces, navigation, drafts, humanIdentity, putAttachment, getAttachment, loadChannels, readThread, loadThreadHistory, threadObservations, subscribeChanges, loadMembers, loadInbox, sendMessage, joinChannel, removeChannelMember, reply, changeTask, promoteThread, selectThread, selectChannel, selectWorkspace, backToWorkspace, backToChannels, resolveTaskRefs, resolveThreadRefs, openMemberSession }) {
    const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot);
    // Every seat names and draws the Human from this one projection: the
    // localized fallback stands only until the first profile read lands.
    const identity = useHumanIdentity(humanIdentity);
    const humanName = identity.name ?? t('human');
    const workspaces = useWorkspaces(state => state.items);
    const current = workspaces.find(workspace => workspace.workspaceId === navigationState.workspaceId);
    if (navigationState.inbox === true) {
        // The Inbox page is global: it merges every visible Workspace and needs no
        // selected Workspace. Selecting Inbox clears the Channel/Thread faces, so
        // this face owns the seat while the flag stands. The Human identity rides
        // along for the same reason it rides on the other two faces: a row that
        // names or draws the reader must draw the one identity every seat draws.
        return _jsx(TeamInboxPage, { useWorkspaces: useWorkspaces, loadInbox: loadInbox, subscribeChanges: subscribeChanges, selectWorkspace: selectWorkspace, selectThread: selectThread, humanName: humanName, ...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl }), t: t }, "inbox");
    }
    if (current !== undefined && navigationState.threadRef !== undefined) {
        return _jsx(TeamThreadPage, { humanName: humanName, ...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl }), workspaceId: current.workspaceId, putAttachment: putAttachment, threadRef: navigationState.threadRef, backToWorkspace: backToWorkspace, selectChannel: selectChannel, selectThread: selectThread, resolveTaskRefs: resolveTaskRefs, resolveThreadRefs: resolveThreadRefs, openMemberSession: openMemberSession, ...(navigationState.channelRef === undefined ? {} : { channelRef: navigationState.channelRef }), ...(navigationState.taskRef === undefined ? {} : { taskRef: navigationState.taskRef }), ...(navigationState.taskNumber === undefined ? {} : { taskNumber: navigationState.taskNumber }), drafts: drafts, getAttachment: getAttachment, readThread: readThread, loadChannels: loadChannels, loadThreadHistory: loadThreadHistory, threadObservations: threadObservations, subscribeChanges: subscribeChanges, loadMembers: loadMembers, reply: reply, changeTask: changeTask, promoteThread: promoteThread, t: t }, navigationState.threadRef);
    }
    if (current !== undefined && navigationState.channelRef !== undefined) {
        return _jsx(TeamChannelPage, { humanName: humanName, ...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl }), workspaceId: current.workspaceId, channelRef: navigationState.channelRef, drafts: drafts, putAttachment: putAttachment, getAttachment: getAttachment, loadChannels: loadChannels, subscribeChanges: subscribeChanges, loadMembers: loadMembers, loadInbox: loadInbox, sendMessage: sendMessage, joinChannel: joinChannel, removeChannelMember: removeChannelMember, selectThread: selectThread, selectChannel: selectChannel, backToChannels: backToChannels, resolveTaskRefs: resolveTaskRefs, resolveThreadRefs: resolveThreadRefs, openMemberSession: openMemberSession, t: t }, navigationState.channelRef);
    }
    const welcome = current === undefined
        ? { eyebrow: t('teamMode'), title: t('team'), body: t('empty') }
        : { eyebrow: current.title, title: t('channels'), body: t('selectChannelHint') };
    return _jsx("main", { className: css.welcomeSurface, "data-team-conversation": true, children: _jsxs("div", { className: css.welcome, children: [_jsx("span", { className: css.welcomeEyebrow, children: welcome.eyebrow }), _jsx("h1", { children: welcome.title }), _jsx("p", { children: welcome.body })] }) });
}
