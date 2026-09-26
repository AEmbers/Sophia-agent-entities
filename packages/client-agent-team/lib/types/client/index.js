import agentTeamRemote from 'dsh-sophia-entities/remote';
import { HumanSettingsSection } from "./HumanSettingsSection.js";
import { TeamHumanIdentity } from "./human-identity.js";
import { bytesToBase64 } from "./attachment-preview.js";
import { TeamNavigation } from "./navigation.js";
import { TeamChangeStream, TeamReadStream } from "./team-changes.js";
import { TeamDraftStore } from "./drafts.js";
import { TeamFooterAction } from "./TeamFooterAction.js";
import { TeamMembersAction } from "./TeamMembersAction.js";
import { TeamConversation } from "./TeamConversation.js";
import { TeamWorkspaceBrowser } from "./TeamWorkspaceBrowser.js";
import { en, zh } from "./locales.js";
export { TeamNavigation } from "./navigation.js";
const NS = 'team';
// DAG team half, ported verbatim from @nanmicoder/dsh-agent-teams 0.1.21 into
// ./dag/ (see docs/development-plan.md §D1/D7). A DSH plugin package owns
// exactly one client entry — `lib/client.js`, whose ModuleLoader id must equal
// the package name — so the two halves cannot ship as two bundles. They are
// composed here instead: one union of runtime services, one `apply` driving
// both surfaces.
import { apply as applyDagTeam, inject as dagTeamInject } from "./dag/index.js";
const teamInject = [
    'slots', 'workspaces', 'locale', 'remote', 'remote.session', 'sessions', 'connection', 'conversation', 'uiWorkspace',
];
/**
 * Union of both halves' service requirements. The module activates only once
 * every name here is available, so the DAG half's services (uiConversation,
 * modelDirectories, layout) gate the Team half too — intentional: a missing
 * service would otherwise crash a slot at render time instead of parking the
 * plugin, which is exactly the failure mode that silently erased the UI before.
 */
export const inject = [...new Set([...teamInject, ...dagTeamInject])];
/**
 * 0.1.7 moved the conversation selection into the workspace service: the
 * rendered session is the one holding its `mainView` reference (the shipped
 * consumers read the same projection), so the Team client reads the selection
 * through retention instead of a service-owned `current`.
 */
function currentMainSessionId(ctx) {
    const sessions = ctx.sessions;
    return Object.values(sessions.list.getSnapshot().byId)
        .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id;
}
/**
 * Session ids this client opened as Member views, per client instance. The
 * 0.1.7 workspace service exposes no clear, so a dead return target leaves
 * the departed Member selection in place; excluding Member sessions from the
 * next capture keeps that stale selection from becoming a false return
 * target.
 */
const openedMemberSessions = new WeakMap();
function registerModeShadow(ctx, navigation, changes, reads, drafts, humanIdentity, name, component, extraInject, 
// Keyed seats (`main`) address one panel by key; the reserved 'conversation'
// key is where the shipped Conversation registers, so the Team seat shadows
// that same panel instead of adding a second one.
entryKey) {
    // Stay in Team mode: the conversation shadow stands down for Member Session
    // views (see registerModeShadow), so the shipped conversation root renders
    // the selected Member Session inside the Team shell.
    const openMemberSessionImpl = (sessionId) => {
        const snapshot = navigation.getSnapshot();
        const current = currentMainSessionId(ctx);
        // The return target is captured on first entry only — switching between
        // Member Sessions must keep pointing at the Human's original session.
        const memberSessions = openedMemberSessions.get(ctx) ?? new Set();
        openedMemberSessions.set(ctx, memberSessions);
        memberSessions.add(sessionId);
        const returnTo = snapshot.memberSessionId === undefined && current !== undefined && current !== sessionId && !memberSessions.has(current) ? current : undefined;
        navigation.actions().enterMemberSession(sessionId, returnTo);
        ctx.uiWorkspace.openSession(sessionId);
    };
    // Remote bindings shared by every Team slot; surface-specific entries extend it below.
    const sharedRemotes = {
        loadChannels: (request) => ctx.remote.agentTeam.view(request),
        loadInbox: (request) => ctx.remote.agentTeam.inbox(request),
        subscribeReads: (listener) => reads.subscribe(listener),
        subscribeChanges: (scope, listener) => changes.subscribe(scope, listener),
        drafts,
        humanIdentity,
        loadMembers: (request) => ctx.remote.agentTeam.members(request),
        joinChannel: (request) => ctx.remote.agentTeam.joinChannel(request),
        removeChannelMember: (request) => ctx.remote.agentTeam.removeChannelMember(request),
        updateChannel: (request) => ctx.remote.agentTeam.updateChannel(request),
        archiveChannel: (request) => ctx.remote.agentTeam.archiveChannel(request),
        updateMember: (request) => ctx.remote.agentTeam.updateMember(request),
        recoverMember: (request) => ctx.remote.agentTeam.recoverMember(request),
        clearMemberContext: (request) => ctx.remote.agentTeam.clearMemberContext(request),
        archiveMember: (request) => ctx.remote.agentTeam.archiveMember(request),
        joinWorkspace: (request) => ctx.remote.agentTeam.joinWorkspace(request),
        leaveWorkspace: (request) => ctx.remote.agentTeam.leaveWorkspace(request),
        // The Host-scoped catalog needs no live Member, so suspended ones stay editable too.
        loadModels: () => ctx.remote.session.modelCatalog(),
        openMemberSession: openMemberSessionImpl,
    };
    ctx.slots.inject(name, () => {
        let dispose;
        const reconcile = () => {
            const snapshot = navigation.getSnapshot();
            // The main panel seat yields to the shipped conversation root while a
            // Member Session view is embedded; both sidebar seats stay shadowed so
            // the Team chrome keeps working around the Member conversation.
            const active = snapshot.mode === 'team' && !(name === 'main' && snapshot.memberSessionId !== undefined);
            if (active && dispose === undefined) {
                dispose = ctx.slots.register({
                    name,
                    ...(entryKey === undefined ? {} : { key: entryKey }),
                    priority: -100,
                    locale: NS,
                    inject: () => ({
                        navigation,
                        ...extraInject?.(),
                        ...navigation.actions(),
                        ...sharedRemotes,
                        ...(name === 'main' ? {
                            // A committed durable read consumes this reader's mention
                            // markers; the Host's changes stream never wakes on reads, so
                            // the Human's badge refreshes from the completed read itself.
                            readThread: async (request) => {
                                const result = await ctx.remote.agentTeam.readThread(request);
                                if (result.ok)
                                    reads.bump();
                                return result;
                            },
                            loadThreadHistory: (request) => ctx.remote.agentTeam.threadHistory(request),
                            threadObservations: (request) => ctx.remote.agentTeam.threadObservations(request),
                            sendMessage: (request) => ctx.remote.agentTeam.sendMessage(request),
                            putAttachment: (request) => ctx.remote.agentTeam.putAttachment(request),
                            getAttachment: (request) => ctx.remote.agentTeam.getAttachment(request),
                            reply: (request) => ctx.remote.agentTeam.reply(request),
                            changeTask: (request) => ctx.remote.agentTeam.changeTask(request),
                            promoteThread: (request) => ctx.remote.agentTeam.promoteThread(request),
                            resolveTaskRefs: (request) => ctx.remote.agentTeam.resolveTaskRefs(request),
                            resolveThreadRefs: (request) => ctx.remote.agentTeam.resolveThreadRefs(request),
                        } : {}),
                        ...(name === 'sidebar.workspaces' ? {
                            addMember: (request) => ctx.remote.agentTeam.addMember(request),
                            createChannel: (request) => ctx.remote.agentTeam.createChannel(request),
                        } : {}),
                    }),
                }, component);
            }
            else if (!active && dispose !== undefined) {
                dispose();
                dispose = undefined;
            }
        };
        const unsubscribe = navigation.subscribe(reconcile);
        reconcile();
        return () => {
            unsubscribe();
            dispose?.();
            dispose = undefined;
        };
    });
}
function applyUi(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-team: dictionaries');
    const navigation = new TeamNavigation();
    const disposeNavigation = ctx.reflect.provide('teamNavigation', navigation);
    const drafts = new TeamDraftStore();
    const disposeDrafts = ctx.reflect.provide('teamDrafts', drafts);
    // The Human's own identity: one projection every seat reads, refreshed once
    // after a profile write so a rename reaches the timeline and the member refs
    // without a reload. Reads are demand-driven — the first seat that subscribes
    // starts the read. The profile page writes back through the Team Remote, so
    // the Client never names the Host's own profile entry.
    const humanIdentity = new TeamHumanIdentity({
        loadProfile: () => ctx.remote.agentTeam.humanProfile({}),
        loadAvatarUrl: async (avatarRef) => {
            // Avatar bytes ride the dedicated avatar Remote (never the TTL-bound
            // attachment cache); a data URL is what an `<img>` seat can show directly.
            const result = await ctx.remote.agentTeam.getHumanAvatar({ avatarRef });
            if (!result.ok || !result.value.mediaType.startsWith('image/'))
                return null;
            return `data:${result.value.mediaType};base64,${result.value.bytesBase64}`;
        },
    });
    ctx.effect(() => () => {
        navigation.dispose();
        drafts.dispose();
        humanIdentity.dispose();
        void disposeNavigation();
        void disposeDrafts();
    }, 'agent-team: navigation service');
    // The one restore owner: leaving an embedded Member Session view must
    // rebind the underlying selection, or the departed Member session stays the
    // workspace service's `mainView` retention into the next Member entry's
    // return-target capture. Takeover is conditional — only when the selection
    // still IS the departed Member session — so a selection someone else made
    // in the meantime survives. A dead return target keeps the departed
    // selection: 0.1.7 exposes no public clear, and the retention is inert
    // behind the Team seat until the next open.
    ctx.effect(() => {
        let previous = navigation.getSnapshot();
        const restore = () => {
            const snapshot = navigation.getSnapshot();
            const departed = previous.memberSessionId;
            const returnTo = previous.returnToSessionId;
            previous = snapshot;
            if (departed === undefined || snapshot.memberSessionId !== undefined)
                return;
            if (currentMainSessionId(ctx) !== departed)
                return;
            if (returnTo !== undefined && ctx.sessions.list.getSnapshot().byId[returnTo] !== undefined)
                ctx.uiWorkspace.openSession(returnTo);
        };
        const unsubscribe = navigation.subscribe(restore);
        return () => {
            unsubscribe();
            restore();
        };
    }, 'agent-team: member session restore');
    const changes = new TeamChangeStream(ctx.remote);
    ctx.effect(() => () => changes.dispose(), 'agent-team: change subscriptions');
    // The Harness resumes a live generation across reconnects, but a stream that
    // already ended for good is this layer's to rebuild — and a new Host generation
    // is the one moment the scope it was waiting for can be there again.
    ctx.on('connection/reset', () => { changes.recover(); });
    const reads = new TeamReadStream();
    const loadMemberGroups = async () => {
        const workspaces = ctx.workspaces.list.getSnapshot().items;
        const groups = await Promise.all(workspaces.map(async (workspace) => {
            const result = await ctx.remote.agentTeam.members({ workspaceId: workspace.workspaceId });
            if (!result.ok)
                throw new Error(result.error.message);
            // The members modal is a listing surface: archived Members are hidden
            // everywhere, and removed (inactive) ones never belong in a roster.
            const members = result.value.filter(status => status.member.state !== 'inactive' && status.member.state !== 'archived');
            return { workspaceId: workspace.workspaceId, workspaceTitle: workspace.title, members };
        }));
        return groups.filter(group => group.members.length > 0);
    };
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'agent-team',
        order: 100,
        locale: NS,
        inject: () => ({
            navigation,
            ...navigation.actions(),
            // The footer is the only surface that leaves Team mode; closing the
            // embedded Member Session view rebinds the underlying selection through
            // the same root-scope restore owner, so there is exactly one restore
            // path and no double open.
            leaveTeam: () => {
                navigation.actions().exitMemberSession();
                navigation.actions().leaveTeam();
            },
        }),
    }, TeamFooterAction));
    registerModeShadow(ctx, navigation, changes, reads, drafts, humanIdentity, 'sidebar.workspaces', TeamWorkspaceBrowser);
    registerModeShadow(ctx, navigation, changes, reads, drafts, humanIdentity, 'main', TeamConversation, undefined, 'conversation');
    registerModeShadow(ctx, navigation, changes, reads, drafts, humanIdentity, 'sidebar.settings', TeamMembersAction, () => ({ loadMemberGroups }));
    // The Human profile page: one settings section, ordered between General (0)
    // and Models (10) so identity sits near the top. Writes go through the Team
    // Remote, which answers with the Host's own rejection reason (a name
    // collides, an empty one), and the shared identity re-reads afterwards, so a
    // rename lands in the timeline and the member refs at the same moment the
    // page shows it.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'team-human',
        order: 5,
        label: () => ctx.locale.bind(NS)('humanSettingsNav'),
        locale: NS,
        inject: () => ({
            identity: humanIdentity,
            saveName: async (name) => {
                const saved = await ctx.remote.agentTeam.setHumanProfile({ name });
                if (!saved.ok)
                    return saved.error.message;
                await humanIdentity.refresh();
                return undefined;
            },
            uploadAvatar: async (file) => {
                const put = await ctx.remote.agentTeam.putHumanAvatar({
                    name: file.name,
                    ...(file.type === '' ? {} : { mediaType: file.type }),
                    bytesBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
                });
                if (!put.ok)
                    return put.error.message;
                const saved = await ctx.remote.agentTeam.setHumanProfile({ avatarRef: put.value.avatarRef });
                if (!saved.ok)
                    return saved.error.message;
                await humanIdentity.refresh();
                return undefined;
            },
            removeAvatar: async () => {
                const { avatarRef } = humanIdentity.getSnapshot();
                if (avatarRef === undefined)
                    return undefined;
                // Bytes first, then the reference: a failed clear leaves a readable
                // avatar instead of a reference to bytes nobody can load.
                await ctx.remote.agentTeam.removeHumanAvatar({ avatarRef });
                const cleared = await ctx.remote.agentTeam.setHumanProfile({ avatarRef: null });
                if (!cleared.ok)
                    return cleared.error.message;
                await humanIdentity.refresh();
                return undefined;
            },
        }),
    }, HumanSettingsSection));
}
export async function apply(ctx) {
    const disposeRemote = await ctx.remote.$mount(agentTeamRemote);
    ctx.effect(() => () => { void disposeRemote(); }, 'agent-team: remote');
    ctx.inject(['remote.agentTeam'], ready => { applyUi(ready); });
    // DAG team surfaces: the activity floater (shell overlay) and the in-chat
    // team card. Independent of the Team half above — it mounts no remote of its
    // own — so it is applied unconditionally rather than behind `remote.agentTeam`.
    applyDagTeam(ctx);
}
