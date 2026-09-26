import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconArchiveOutlineRegular, IconEditOutlineRegular, IconPlusOutlineRegular, Input, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { TeamPresenceDot } from "./TeamPresenceDot.js";
import { TeamMemberRow } from "./TeamMemberRow.js";
import { MultiMenuField } from "./multi-menu-field.js";
import { SortableRow, useSidebarRowDrag } from "./sidebar-drag.js";
import { moveSidebarItem, useSidebarOrder } from "./sidebar-order.js";
import { useSidebarSectionOpen, setSidebarSectionOpen } from "./sidebar-sections.js";
import { mintRequestId } from "./requests.js";
import { TeamRowMenu } from "./TeamRowMenu.js";
import { TeamSidebarSection } from "./TeamSidebarSection.js";
import { useChannelMembership } from "./team-membership.js";
import { useEditDialogSave } from "./team-dialog-save.js";
import createCss from './create.module.css';
import css from './sidebar.module.css';
export function TeamChannelsPanel(props) {
    const { workspaceId, loadMembers, loadChannels, subscribeChanges, createChannel, updateChannel, creatingAgents, selectedChannelRef, selectChannel, t } = props;
    const [view, setView] = useState();
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState();
    const [formOpen, setFormOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [selected, setSelected] = useState(new Set());
    const [mutating, setMutating] = useState(false);
    const [pendingCreate, setPendingCreate] = useState();
    const previousCreatingKey = useRef(creatingAgents.map(request => request.requestId).join(','));
    const triggerRef = useRef(null);
    // Row order is this browser's presentation preference; the drag commits
    // through the single shared mutation below.
    const channelRefs = useMemo(() => view?.channels.map(channel => channel.channelRef) ?? [], [view]);
    const orderedChannelRefs = useSidebarOrder(workspaceId, 'channels', channelRefs);
    const orderedChannels = useMemo(() => {
        const byRef = new Map((view?.channels ?? []).map(channel => [channel.channelRef, channel]));
        return orderedChannelRefs.map(channelRef => byRef.get(channelRef)).filter(channel => channel !== undefined);
    }, [orderedChannelRefs, view]);
    const applyMove = (movedRef, targetRef, marker) => {
        void moveSidebarItem(workspaceId, 'channels', orderedChannelRefs, movedRef, targetRef, marker);
    };
    const drag = useSidebarRowDrag({ refs: orderedChannelRefs, onCommit: applyMove });
    const sectionOpen = useSidebarSectionOpen(workspaceId, 'channels');
    // Only the first refresh owns the loading surface; later wakes (workspace
    // catalog changes, member creation) refresh the rendered rows in place.
    const loadedRef = useRef(false);
    const refresh = useCallback(async () => {
        if (!loadedRef.current)
            setLoading(true);
        const [channelResult, memberResult] = await Promise.all([
            loadChannels({ workspaceId, limit: 1 }),
            loadMembers({ workspaceId }),
        ]);
        if (channelResult.ok && memberResult.ok) {
            setView(channelResult.value);
            const visibleMembers = memberResult.value.filter(status => status.member.state !== 'inactive' && status.member.state !== 'archived');
            setMembers(visibleMembers);
            const selectable = new Set(visibleMembers.filter(status => status.presence !== 'unavailable')
                .map(status => status.member.memberId));
            setSelected(current => new Set([...current].filter(memberId => selectable.has(memberId))));
            setError(undefined);
            loadedRef.current = true;
        }
        else if (!channelResult.ok) {
            setError(channelResult.error.message);
        }
        else if (!memberResult.ok) {
            setError(memberResult.error.message);
        }
        setLoading(false);
    }, [loadChannels, loadMembers, workspaceId]);
    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => subscribeChanges({ kind: 'workspace', workspaceId }, update => {
        if (update.type === 'failed') {
            setError(update.message);
            return;
        }
        void refresh();
    }), [subscribeChanges, refresh, workspaceId]);
    const creatingKey = creatingAgents.map(request => request.requestId).join(',');
    useEffect(() => {
        if (previousCreatingKey.current === creatingKey)
            return;
        previousCreatingKey.current = creatingKey;
        void refresh();
    }, [creatingKey, refresh]);
    const membership = useMemo(() => {
        const byChannel = new Map();
        for (const item of view?.members ?? []) {
            const ids = byChannel.get(item.channelRef) ?? new Set();
            ids.add(item.memberId);
            byChannel.set(item.channelRef, ids);
        }
        return byChannel;
    }, [view]);
    const closeForm = () => {
        if (mutating)
            return;
        setFormOpen(false);
        queueMicrotask(() => { triggerRef.current?.focus(); });
    };
    const submit = async (event) => {
        event.preventDefault();
        if (mutating || name.trim() === '')
            return;
        const payload = { workspaceId, name: name.trim(), description: description.trim(), memberIds: [...selected] };
        const samePending = pendingCreate !== undefined && pendingCreate.workspaceId === payload.workspaceId
            && pendingCreate.name === payload.name && pendingCreate.description === payload.description
            && JSON.stringify(pendingCreate.memberIds) === JSON.stringify(payload.memberIds);
        const request = samePending ? pendingCreate : {
            requestId: mintRequestId(), ...payload,
        };
        setPendingCreate(request);
        setMutating(true);
        setError(undefined);
        try {
            const result = await createChannel(request);
            if (result.ok) {
                setPendingCreate(undefined);
                setName('');
                setDescription('');
                setSelected(new Set());
                setFormOpen(false);
                await refresh();
                queueMicrotask(() => { triggerRef.current?.focus(); });
            }
            else {
                setError(result.error.message);
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setMutating(false);
        }
    };
    return (_jsxs("div", { className: css.panel, children: [_jsx(Modal, { open: formOpen, onClose: closeForm, title: t('addChannel'), closeLabel: t('close'), contentClassName: createCss.dialogContent, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: mutating, onClick: closeForm, children: t('cancel') }), _jsx(Button, { type: "submit", form: "team-channel-create-form", variant: "primary", disabled: mutating || name.trim() === '', children: mutating ? t('creatingChannel') : t('createChannel') })] }), children: _jsxs("form", { id: "team-channel-create-form", className: createCss.form, onSubmit: event => { void submit(event); }, children: [_jsxs("label", { className: createCss.field, children: [_jsx("span", { children: t('channelName') }), _jsx(Input, { className: createCss.input, value: name, disabled: mutating, autoFocus: true, onChange: event => { setName(event.target.value); setPendingCreate(undefined); } })] }), _jsxs("label", { className: createCss.field, children: [_jsxs("span", { children: [t('channelDescription'), t('optionalSuffix')] }), _jsx(Input, { className: createCss.input, value: description, placeholder: t('agentDescriptionPlaceholder'), disabled: mutating, onChange: event => { setDescription(event.target.value); setPendingCreate(undefined); } })] }), _jsx(MultiMenuField, { label: t('initialMembers'), disabled: mutating, options: [
                                ...creatingAgents.map(request => ({ id: request.requestId, label: request.handle, disabled: true, hint: t('memberCreatingReason') })),
                                ...members.map(status => ({
                                    id: status.member.memberId,
                                    label: status.member.handle,
                                    ...(status.presence === 'unavailable' ? { disabled: true, hint: t('memberUnavailableReason') } : {}),
                                    icon: _jsx(TeamPresenceDot, { status: status, t: t }),
                                })),
                            ], selected: [...selected], onToggle: id => {
                                setSelected(current => {
                                    const next = new Set(current);
                                    if (next.has(id))
                                        next.delete(id);
                                    else
                                        next.add(id);
                                    return next;
                                });
                                setPendingCreate(undefined);
                            }, triggerEmptyLabel: t('membersPickerEmpty'), formatCount: count => t('membersPickerCount', { count }) }), error !== undefined && _jsx("p", { className: createCss.error, role: "alert", children: error })] }) }), _jsxs(TeamSidebarSection, { title: t('channels'), open: sectionOpen, onToggle: open => { setSidebarSectionOpen(workspaceId, 'channels', open); }, actions: (_jsx(Tooltip, { label: t('addChannel'), delayMs: 500, children: _jsx("button", { ref: triggerRef, type: "button", className: css.iconButton, "aria-label": t('addChannel'), onClick: () => { setError(undefined); setFormOpen(true); }, children: _jsx(IconPlusOutlineRegular, { size: 14 }) }) })), children: [loading && view === undefined && _jsx("p", { className: css.emptyState, children: t('loadingChannels') }), !loading && error === undefined && view !== undefined && view.channels.length === 0 && _jsx("p", { className: css.emptyState, children: t('emptyChannels') }), _jsx("div", { className: css.channelList, children: orderedChannels.map(channel => {
                            const joined = membership.get(channel.channelRef) ?? new Set();
                            return (_jsx(SortableRow, { drag: drag, orderKey: channel.channelRef, children: _jsx(ChannelRow, { channel: channel, members: members, joinedIds: joined, selected: selectedChannelRef === channel.channelRef, updateChannel: updateChannel, archiveChannel: props.archiveChannel, joinChannel: props.joinChannel, removeChannelMember: props.removeChannelMember, onCommitted: () => { void refresh(); }, selectChannel: selectChannel, t: t }) }, channel.channelRef));
                        }) })] }), !formOpen && error !== undefined && _jsx("p", { className: css.error, role: "alert", children: error })] }));
}
/**
 * One sidebar Channel row: the select button keeps the `#` identity while the
 * row menu carries the entry point; editing covers display facts and membership.
 */
function ChannelRow({ channel, members, joinedIds, selected, updateChannel, archiveChannel, joinChannel, removeChannelMember, onCommitted, selectChannel, t }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [archiving, setArchiving] = useState(false);
    const [rowAlert, setRowAlert] = useState();
    const archive = async () => {
        try {
            const result = await archiveChannel({
                requestId: mintRequestId(),
                workspaceId: channel.workspaceId,
                channelRef: channel.channelRef,
            });
            await onCommitted();
            if (!result.ok) {
                setRowAlert(t('archiveChannelFailed', { message: result.error.message }));
            }
        }
        catch (cause) {
            setRowAlert(t('archiveChannelFailed', { message: cause instanceof Error ? cause.message : String(cause) }));
        }
    };
    return (_jsxs(_Fragment, { children: [_jsxs("article", { className: css.channelRow, "data-menu-open": menuOpen || undefined, "aria-current": selected ? 'page' : undefined, children: [_jsx("button", { type: "button", className: css.channelSelect, "aria-label": `# ${channel.name}`, onClick: () => { selectChannel(channel.channelRef); }, children: _jsxs("strong", { className: css.channelName, children: ["# ", channel.name] }) }), _jsx("span", { className: css.rowMenu, children: _jsx(TeamRowMenu, { label: t('actionsChannel', { name: channel.name }), items: [
                                { id: 'edit', label: t('editChannel'), icon: _jsx(IconEditOutlineRegular, {}) },
                                { id: 'archive', label: t('archiveChannel'), icon: _jsx(IconArchiveOutlineRegular, { size: 16 }), danger: true },
                            ], onSelect: (id) => {
                                if (id === 'edit')
                                    setEditing(true);
                                else
                                    setArchiving(true);
                            }, onOpenChange: setMenuOpen }) })] }), rowAlert !== undefined && _jsx("div", { className: css.rowAlert, role: "alert", children: rowAlert }), archiving && (_jsx(Modal, { open: true, onClose: () => { setArchiving(false); }, title: t('archiveChannelTitle', { name: channel.name }), closeLabel: t('close'), contentClassName: createCss.dialogContent, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", onClick: () => { setArchiving(false); }, children: t('cancel') }), _jsx(Button, { variant: "primary", onClick: () => { setArchiving(false); void archive(); }, children: t('archiveChannelConfirm') })] }), children: _jsx("p", { className: createCss.error, children: t('archiveChannelNotice', { name: channel.name }) }) })), editing && (_jsx(ChannelEditorDialog, { channel: channel, members: members, joinedIds: joinedIds, updateChannel: updateChannel, joinChannel: joinChannel, removeChannelMember: removeChannelMember, onCommitted: onCommitted, onClose: () => { setEditing(false); }, t: t }))] }));
}
/**
 * Channel editor: name and description commit through one durable update;
 * Channel membership below keeps its own immediate add/remove flow.
 */
function ChannelEditorDialog({ channel, members, joinedIds, updateChannel, joinChannel, removeChannelMember, onCommitted, onClose, t }) {
    const [name, setName] = useState(channel.name);
    const [description, setDescription] = useState(channel.description);
    const { saving, error, pendingRequest, save } = useEditDialogSave({
        save: updateChannel,
        onCommitted,
        onClose,
    });
    const membership = useChannelMembership({ joinChannel, removeChannelMember }, change => change.memberId, async () => { await onCommitted(); });
    const dirty = name.trim() !== channel.name || description.trim() !== channel.description;
    const submit = async (event) => {
        event.preventDefault();
        const normalizedName = name.trim();
        const normalizedDescription = description.trim();
        if (saving || !dirty || normalizedName === '')
            return;
        const samePending = pendingRequest.current !== undefined && pendingRequest.current.channelRef === channel.channelRef
            && pendingRequest.current.name === normalizedName && pendingRequest.current.description === normalizedDescription;
        const request = samePending ? pendingRequest.current : {
            requestId: mintRequestId(),
            workspaceId: channel.workspaceId,
            channelRef: channel.channelRef,
            name: normalizedName,
            description: normalizedDescription,
        };
        await save(request);
    };
    return (_jsx(Modal, { open: true, onClose: onClose, title: t('editChannel'), description: `# ${channel.name}`, closeLabel: t('close'), contentClassName: createCss.dialogContent, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: saving, onClick: onClose, children: t('cancel') }), _jsx(Button, { type: "submit", form: "team-channel-edit-form", variant: "primary", disabled: saving || !dirty || name.trim() === '', children: saving ? t('editSaving') : t('editSave') })] }), children: _jsxs("form", { id: "team-channel-edit-form", className: createCss.form, onSubmit: event => { void submit(event); }, children: [_jsxs("label", { className: createCss.field, children: [_jsx("span", { children: t('channelName') }), _jsx(Input, { className: createCss.input, value: name, onChange: event => { setName(event.target.value); pendingRequest.current = undefined; }, disabled: saving, autoFocus: true })] }), _jsxs("label", { className: createCss.field, children: [_jsxs("span", { children: [t('channelDescription'), t('optionalSuffix')] }), _jsx(Input, { className: createCss.input, value: description, placeholder: t('agentDescriptionPlaceholder'), onChange: event => { setDescription(event.target.value); pendingRequest.current = undefined; }, disabled: saving })] }), _jsxs("fieldset", { className: createCss.memberPicker, disabled: saving, children: [_jsx("legend", { children: t('channelMembersSection') }), members.map(status => {
                            const joined = joinedIds.has(status.member.memberId);
                            const rowPending = membership.pending.has(status.member.memberId);
                            // Same membership law as the Channel page roster: joining needs an
                            // active Member, leaving only needs the fact.
                            const disabled = rowPending || (!joined && status.availability !== 'active');
                            const rowError = membership.errors.get(status.member.memberId);
                            return _jsx(TeamMemberRow, { status: status, action: {
                                    label: rowPending ? t('membershipUpdating') : joined ? t('removeFromChannel') : t('addToChannel'),
                                    disabled,
                                    onSelect: () => { void membership.change({ workspaceId: channel.workspaceId, channelRef: channel.channelRef, memberId: status.member.memberId, joined }); },
                                }, ...(rowError === undefined ? {} : { error: rowError }), t: t }, status.member.memberId);
                        })] }), error !== undefined && _jsx("p", { className: createCss.error, role: "alert", children: error })] }) }));
}
