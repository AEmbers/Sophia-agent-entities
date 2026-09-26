import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Button, IconChevronDownOutlineRegular, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { mintRequestId } from "./requests.js";
import { useEditDialogSave } from "./team-dialog-save.js";
import createCss from './create.module.css';
import css from './sidebar.module.css';
/** Model option key inside one editor; opaque and resolved against the loaded groups. */
function modelKey(provider, model) {
    return `${provider}\u0000${model}`;
}
const modelCatalogCaches = new WeakMap();
function peekCatalogGroups(loadModels) {
    return modelCatalogCaches.get(loadModels)?.value?.groups;
}
function sharedCatalog(loadModels) {
    const cached = modelCatalogCaches.get(loadModels);
    if (cached?.inflight !== undefined)
        return cached.inflight;
    const next = loadModels();
    const entry = cached ?? {};
    entry.inflight = next;
    modelCatalogCaches.set(loadModels, entry);
    const forget = (result) => {
        if (modelCatalogCaches.get(loadModels) === entry && entry.inflight === next) {
            delete entry.inflight;
            if (result !== undefined && result.ok)
                entry.value = result.value;
        }
    };
    next.then((result) => { forget(result); }, () => { forget(undefined); });
    return next;
}
/**
 * Best-effort warm of the shared catalog (the agents panel calls this while
 * the roster loads, so the pickers open with rows instead of paying the
 * first read on open). Failures belong to the picker's own error surface.
 */
export function warmModelCatalog(loadModels) {
    try {
        void sharedCatalog(loadModels).catch(() => {
            // The picker that later reads surfaces the failure with its retry entry.
        });
    }
    catch {
        // Same: a synchronously refused warm leaves no trace; the picker reports it.
    }
}
/**
 * Shared provider/model dropdown for the create and edit forms. The option
 * list rides the shared Menu primitive (one leading "follow Host default"
 * row, then non-selectable provider headings) with a capped, internally
 * scrolling card so growing model catalogs cannot stretch the dialog. Mounts
 * open with the warmed value when one exists and revalidate behind it, so a
 * slow Host read delays a refresh — never the picker itself; a refused or
 * failed read with no warmed value renders a retryable error instead of
 * stranding the field on "loading".
 */
export function ModelPickerField({ model, onModelChange, loadModels, disabled, t }) {
    const [groups, setGroups] = useState(() => peekCatalogGroups(loadModels));
    const [modelsError, setModelsError] = useState();
    const [reloadToken, setReloadToken] = useState(0);
    const [open, setModelOpen] = useState(false);
    const [effortOpen, setEffortOpen] = useState(false);
    useEffect(() => {
        let mounted = true;
        let pending;
        try {
            pending = sharedCatalog(loadModels);
        }
        catch (error) {
            // A synchronously refused read (an undeclared remote, a dead scope)
            // used to strand the field on "loading" forever with no diagnostic;
            // surface it as the same retryable failure an answered refusal gets.
            // Last good rows stay rendered underneath, matching a refused answer.
            setModelsError(error instanceof Error ? error.message : String(error));
            return;
        }
        void pending.then((result) => {
            if (!mounted)
                return;
            if (result.ok) {
                setGroups(result.value.groups);
                setModelsError(undefined);
            }
            else {
                setModelsError(result.error.message);
            }
        }, (error) => {
            // A rejected read (a transport that died mid-call) previously fell
            // through as an unhandled rejection behind the same endless loading
            // line; it retries like any other failure.
            if (!mounted)
                return;
            setModelsError(error instanceof Error ? error.message : String(error));
        });
        return () => { mounted = false; };
    }, [loadModels, reloadToken]);
    const items = [{ id: '', label: t('modelFollowDefault') }];
    const byKey = new Map();
    for (const group of groups ?? []) {
        items.push({ type: 'label', id: `model-group:${group.id}`, text: group.name });
        for (const entry of group.models) {
            const key = modelKey(group.id, entry.id);
            byKey.set(key, { provider: group.id, id: entry.id, name: entry.name, efforts: entry.reasoning?.efforts ?? [] });
            items.push({ id: key, label: entry.name });
        }
    }
    const selectedModelKey = model === undefined ? '' : modelKey(model.provider, model.model);
    const triggerLabel = model === undefined
        ? t('modelFollowDefault')
        : byKey.get(selectedModelKey)?.name ?? `${model.provider} / ${model.model}`;
    // The effort sub-row only makes sense for a pinned model with adapter-exposed
    // efforts; following the Host default inherits the operator's whole selection.
    const efforts = model === undefined ? [] : byKey.get(selectedModelKey)?.efforts ?? [];
    const effortItems = [{ id: '', label: t('effortFollowDefault') }, ...efforts.map(effort => ({ id: effort.id, label: effort.name }))];
    const selectedEffort = model?.reasoningEffort ?? '';
    const effortTriggerLabel = model === undefined || selectedEffort === ''
        ? t('effortFollowDefault')
        : efforts.find(effort => effort.id === selectedEffort)?.name ?? selectedEffort;
    return _jsxs("div", { className: createCss.field, children: [_jsx("span", { children: t('memberModel') }), groups === undefined && modelsError === undefined && _jsx("small", { className: css.editHint, children: t('modelsLoading') }), modelsError !== undefined && (_jsxs("p", { className: css.editHint, children: [_jsx("span", { role: "alert", children: t('modelsLoadFailed', { message: modelsError }) }), ' ', _jsx(Button, { size: "sm", variant: "outline", disabled: disabled, onClick: () => { setModelsError(undefined); setReloadToken(token => token + 1); }, children: t('retry') })] })), groups !== undefined && (_jsx(Menu, { open: open, portal: true, className: createCss.menuCap, items: items, selectedId: selectedModelKey, onSelect: key => {
                    setModelOpen(false);
                    const choice = byKey.get(key);
                    onModelChange(choice === undefined ? undefined : { provider: choice.provider, model: choice.id });
                }, onClose: () => { setModelOpen(false); }, anchor: _jsxs("button", { type: "button", className: createCss.selectTrigger, "aria-label": t('memberModel'), "aria-haspopup": "menu", "aria-expanded": open, disabled: disabled, onClick: () => { setModelOpen(value => !value); }, children: [_jsx("span", { className: createCss.selectValue, children: triggerLabel }), _jsx("span", { className: `${createCss.chevron} ${open ? createCss.chevronOpen : ''}`, "aria-hidden": true, children: _jsx(IconChevronDownOutlineRegular, {}) })] }) })), model !== undefined && efforts.length > 0 && (_jsx(Menu, { open: effortOpen, portal: true, className: createCss.menuCap, items: effortItems, selectedId: selectedEffort, onSelect: key => {
                    setEffortOpen(false);
                    onModelChange(key === ''
                        ? { provider: model.provider, model: model.model }
                        : { provider: model.provider, model: model.model, reasoningEffort: key });
                }, onClose: () => { setEffortOpen(false); }, anchor: _jsxs("button", { type: "button", className: createCss.selectTrigger, "aria-label": t('reasoningEffort'), "aria-haspopup": "menu", "aria-expanded": effortOpen, disabled: disabled, onClick: () => { setEffortOpen(value => !value); }, children: [_jsx("span", { className: createCss.selectValue, children: `${t('reasoningEffort')} · ${effortTriggerLabel}` }), _jsx("span", { className: `${createCss.chevron} ${effortOpen ? createCss.chevronOpen : ''}`, "aria-hidden": true, children: _jsx(IconChevronDownOutlineRegular, {}) })] }) }))] });
}
/**
 * Agent editor: handle, description, and per-Member model selection commit
 * through one durable update. Channel membership is managed from the Channel
 * side, not here.
 */
export function AgentEditorDialog({ status, updateMember, loadModels, onCommitted, onClose, t }) {
    const memberId = status.member.memberId;
    const [handle, setHandle] = useState(status.member.handle);
    const [description, setDescription] = useState(status.member.description);
    const [model, setModel] = useState(status.member.model);
    const { saving, error, pendingRequest, save } = useEditDialogSave({
        save: updateMember,
        onCommitted,
        onClose,
    });
    const dirty = handle.trim() !== status.member.handle || description.trim() !== status.member.description
        || !sameModel(model, status.member.model);
    const submit = async (event) => {
        event.preventDefault();
        const normalizedHandle = handle.trim();
        const normalizedDescription = description.trim();
        if (saving || !dirty || normalizedHandle.length === 0)
            return;
        const payload = {
            memberId,
            handle: normalizedHandle,
            description: normalizedDescription,
            ...(model === undefined ? {} : { model }),
            // The editor owns no capabilities UI, but an absent field would clear a
            // Remote-written override; echo the stored intent through the edit.
            ...(status.member.capabilities === undefined ? {} : { capabilities: status.member.capabilities }),
        };
        const samePending = pendingRequest.current !== undefined && pendingRequest.current.memberId === payload.memberId
            && pendingRequest.current.handle === payload.handle && pendingRequest.current.description === payload.description
            && sameModel(pendingRequest.current.model, model);
        const request = samePending ? pendingRequest.current : {
            requestId: mintRequestId(),
            ...payload,
        };
        await save(request);
    };
    return (_jsx(Modal, { open: true, onClose: onClose, title: t('editAgent'), description: `@${status.member.handle}`, closeLabel: t('close'), contentClassName: createCss.dialogContent, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: saving, onClick: onClose, children: t('cancel') }), _jsx(Button, { type: "submit", form: "team-agent-edit-form", variant: "primary", disabled: saving || !dirty || handle.trim().length === 0, children: saving ? t('editSaving') : t('editSave') })] }), children: _jsxs("form", { id: "team-agent-edit-form", className: createCss.form, onSubmit: event => { void submit(event); }, children: [_jsxs("label", { className: createCss.field, children: [_jsx("span", { children: t('agentName') }), _jsx(Input, { className: createCss.input, value: handle, onChange: event => { setHandle(event.target.value); pendingRequest.current = undefined; }, disabled: saving, autoFocus: true })] }), _jsxs("label", { className: createCss.field, children: [_jsxs("span", { children: [t('agentDescription'), t('optionalSuffix')] }), _jsx(Input, { className: createCss.input, value: description, placeholder: t('agentDescriptionPlaceholder'), onChange: event => { setDescription(event.target.value); pendingRequest.current = undefined; }, disabled: saving })] }), _jsx(ModelPickerField, { model: model, onModelChange: choice => { pendingRequest.current = undefined; setModel(choice); }, loadModels: loadModels, disabled: saving, t: t }), error !== undefined && _jsx("p", { className: createCss.error, role: "alert", children: error })] }) }));
}
export function sameModel(left, right) {
    if (left === undefined && right === undefined)
        return true;
    if (left === undefined || right === undefined)
        return false;
    return left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort;
}
