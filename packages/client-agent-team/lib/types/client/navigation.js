const STORAGE_KEY = 'dsh.agent-team.navigation';
function readSnapshot() {
    if (typeof localStorage === 'undefined')
        return { mode: 'conversation' };
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '');
        const hasThread = typeof parsed.threadRef === 'string';
        return {
            mode: parsed.mode === 'team' ? 'team' : 'conversation',
            ...(typeof parsed.workspaceId === 'string' ? { workspaceId: parsed.workspaceId } : {}),
            ...(typeof parsed.channelRef === 'string' ? { channelRef: parsed.channelRef } : {}),
            ...(parsed.inbox === true ? { inbox: true } : {}),
            ...(hasThread ? {
                threadRef: parsed.threadRef,
                ...(typeof parsed.taskRef === 'string' ? { taskRef: parsed.taskRef } : {}),
                ...(typeof parsed.taskNumber === 'number' && Number.isInteger(parsed.taskNumber) && parsed.taskNumber > 0 ? { taskNumber: parsed.taskNumber } : {}),
            } : {}),
        };
    }
    catch {
        return { mode: 'conversation' };
    }
}
function persistSnapshot(snapshot) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        const { mode, workspaceId, channelRef, taskRef, threadRef, taskNumber, inbox } = snapshot;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            mode,
            ...(workspaceId === undefined ? {} : { workspaceId }),
            ...(channelRef === undefined ? {} : { channelRef }),
            ...(inbox === true ? { inbox: true } : {}),
            ...(taskRef === undefined ? {} : { taskRef }),
            ...(threadRef === undefined ? {} : { threadRef }),
            ...(taskNumber === undefined ? {} : { taskNumber }),
        }));
    }
    catch {
        // Local persistence is a convenience; private mode and quota failures do not block navigation.
    }
}
/** Root-scoped Team mode state. Slot lifetimes subscribe to this source. */
export class TeamNavigation {
    snapshot = readSnapshot();
    listeners = new Set();
    getSnapshot = () => this.snapshot;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    actions() {
        return {
            enterTeam: () => { this.clearMemberSession(); this.setMode('team'); },
            leaveTeam: () => { this.setMode('conversation'); },
            selectWorkspace: workspaceId => { this.clearMemberSession(); this.setWorkspace(workspaceId); },
            selectChannel: channelRef => { this.clearMemberSession(); this.setChannel(channelRef); },
            selectThread: (threadRef, channelRef, taskRef, taskNumber) => { this.clearMemberSession(); this.setThread(threadRef, channelRef, taskRef, taskNumber); },
            selectInbox: () => { this.clearMemberSession(); this.setInbox(); },
            backToWorkspace: () => { this.clearMemberSession(); this.setThread(undefined); },
            backToChannels: () => { this.clearMemberSession(); this.clearChannel(); },
            enterMemberSession: (sessionId, returnToSessionId) => { this.setMemberSession(sessionId, returnToSessionId); },
            exitMemberSession: () => { this.clearMemberSession(); },
        };
    }
    dispose() {
        this.listeners.clear();
    }
    setMode(mode) {
        if (this.snapshot.mode === mode)
            return;
        this.snapshot = { ...this.snapshot, mode };
        this.commit();
    }
    setMemberSession(sessionId, returnToSessionId) {
        // Re-selecting the active Member keeps the original return target.
        if (this.snapshot.memberSessionId === sessionId && this.snapshot.mode === 'team')
            return;
        const { memberSessionId: _memberSessionId, ...base } = this.snapshot;
        this.snapshot = {
            ...base,
            mode: 'team',
            memberSessionId: sessionId,
            ...(returnToSessionId === undefined ? {} : { returnToSessionId }),
        };
        this.commit();
    }
    /** Any explicit Team navigation or the footer leave closes a Member view. */
    clearMemberSession() {
        if (this.snapshot.memberSessionId === undefined && this.snapshot.returnToSessionId === undefined)
            return;
        const { memberSessionId: _memberSessionId, returnToSessionId: _returnToSessionId, ...base } = this.snapshot;
        this.snapshot = base;
        this.commit();
    }
    setWorkspace(workspaceId) {
        if (this.snapshot.workspaceId === workspaceId && this.snapshot.inbox !== true)
            return;
        const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, inbox: _inbox, ...base } = this.snapshot;
        this.snapshot = { ...base, workspaceId };
        this.commit();
    }
    setChannel(channelRef) {
        if (this.snapshot.channelRef === channelRef && this.snapshot.threadRef === undefined && this.snapshot.inbox !== true)
            return;
        const { taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, inbox: _inbox, ...base } = this.snapshot;
        this.snapshot = { ...base, channelRef };
        this.commit();
    }
    /** The Inbox is a face, not workspace content: selecting a Workspace leaves it. */
    setInbox() {
        if (this.snapshot.inbox === true && this.snapshot.channelRef === undefined && this.snapshot.threadRef === undefined)
            return;
        const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, ...base } = this.snapshot;
        this.snapshot = { ...base, inbox: true };
        this.commit();
    }
    clearChannel() {
        const { channelRef: _channelRef, ...base } = this.snapshot;
        if (this.snapshot.channelRef === undefined)
            return;
        this.snapshot = base;
        this.commit();
    }
    setThread(threadRef, channelRef, taskRef, taskNumber) {
        if (this.snapshot.threadRef === threadRef && this.snapshot.taskRef === taskRef && this.snapshot.channelRef === channelRef && this.snapshot.taskNumber === taskNumber && this.snapshot.inbox !== true)
            return;
        if (threadRef === undefined) {
            const { taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, ...base } = this.snapshot;
            this.snapshot = base;
        }
        else {
            const { channelRef: _channelRef, taskRef: _taskRef, threadRef: _threadRef, taskNumber: _taskNumber, inbox: _inbox, ...base } = this.snapshot;
            this.snapshot = {
                ...base,
                threadRef,
                ...(channelRef === undefined ? {} : { channelRef }),
                ...(taskRef === undefined ? {} : { taskRef }),
                ...(taskNumber === undefined ? {} : { taskNumber }),
            };
        }
        this.commit();
    }
    commit() {
        persistSnapshot(this.snapshot);
        for (const listener of this.listeners)
            listener();
    }
}
export { STORAGE_KEY };
