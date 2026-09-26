import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconChecklistOutlineMedium, IconPaperclipOutlineMedium, IconSendOutlineRegular, Tooltip, useAnchoredMaxHeight, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives';
import { TeamPresenceDot } from "./TeamPresenceDot.js";
import { allMentionMembers, containsAllMention, containsMention, mentionedMemberIds } from "./team-formatters.js";
import css from './composer.module.css';
import { formatByteSize } from "./attachment-preview.js";
function findMention(draft, caret) {
    const beforeCaret = draft.slice(0, caret);
    if (beforeCaret.length === 0 || /\s/u.test(beforeCaret.at(-1) ?? ''))
        return undefined;
    let tokenStart = beforeCaret.length;
    while (tokenStart > 0 && !/\s/u.test(beforeCaret[tokenStart - 1]))
        tokenStart -= 1;
    const at = beforeCaret.lastIndexOf('@');
    if (at < tokenStart)
        return undefined;
    if (at > 0 && /[\p{L}\p{N}_]/u.test(beforeCaret[at - 1]))
        return undefined;
    return { start: at, end: caret, query: beforeCaret.slice(at + 1) };
}
function mentionCandidates(members, query) {
    const normalized = query.toLocaleLowerCase();
    return members.filter(status => status.presence !== 'unavailable'
        && status.member.state !== 'inactive'
        && status.member.state !== 'archived'
        && status.member.handle.toLocaleLowerCase().startsWith(normalized));
}
/** Thread followers rank first: mentioning them delivers directly, while a non-follower enters the two-send invite flow. */
function rankMentionCandidates(candidates, followers) {
    if (followers === undefined || followers.size === 0)
        return candidates;
    return [...candidates].sort((left, right) => Number(followers.has(right.member.memberId)) - Number(followers.has(left.member.memberId)));
}
/** One object URL per draft file; revoked when the draft is removed. */
const draftPreviewUrls = new WeakMap();
function draftPreviewUrl(file) {
    if (!file.type.startsWith('image/'))
        return undefined;
    let url = draftPreviewUrls.get(file);
    if (url === undefined) {
        url = URL.createObjectURL(file);
        draftPreviewUrls.set(file, url);
    }
    return url;
}
export function TeamComposer({ members, followerMemberIds, drafts, draftKey, pending, confirmation, error, onEdit, onSubmit, placeholder, pendingFiles, onFilesChange, asTask, onAsTaskChange, t }) {
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const rootRef = useRef(null);
    const menuRef = useRef(null);
    const activeOptionRef = useRef(null);
    const composingRef = useRef(false);
    // The draft lives in the injected cache so a view switch or refresh does not
    // cost the half-written message. Subscribing here — not in the page that
    // hosts this composer — is what keeps a keystroke off the timeline.
    const { draft, recipients } = useSyncExternalStore(drafts.subscribe, () => drafts.getSnapshot(draftKey));
    const [mention, setMention] = useState();
    const [highlight, setHighlight] = useState(0);
    // @all is a composer-layer expansion of the same eligibility filter a
    // handle pick uses; the fixed row stays on top of the matching members.
    const memberCandidates = mention === undefined ? [] : rankMentionCandidates(mentionCandidates(members, mention.query), followerMemberIds);
    const options = mention !== undefined && 'all'.startsWith(mention.query.toLocaleLowerCase())
        ? [{ kind: 'all' }, ...memberCandidates.map(status => ({ kind: 'member', status }))]
        : memberCandidates.map(status => ({ kind: 'member', status }));
    const menuOpen = mention !== undefined && options.length > 0;
    const activeOption = options[highlight];
    const activeOptionKey = activeOption === undefined ? undefined : activeOption.kind === 'all' ? 'all' : activeOption.status.member.memberId;
    const allCount = allMentionMembers(members).length;
    const listId = 'team-mention-suggestions';
    const menuMaxHeight = useAnchoredMaxHeight(menuRef, 320, menuOpen ? draft : null);
    useDismissOnOutsidePointer(rootRef, menuOpen, open => { if (!open)
        setMention(undefined); });
    useLayoutEffect(() => {
        const input = inputRef.current;
        if (input === null)
            return;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    }, [draft]);
    useEffect(() => {
        if (mention === undefined || options.length === 0) {
            setHighlight(0);
            return;
        }
        setHighlight(current => Math.min(current, options.length - 1));
    }, [mention, options.length]);
    // The anchored height cap keeps long rosters scrollable; without this the
    // keyboard-highlighted row can stay hidden below the fold.
    useLayoutEffect(() => {
        if (!menuOpen)
            return;
        // Optional call: jsdom renders the menu without a layout engine.
        activeOptionRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [menuOpen, highlight, activeOptionKey]);
    // Match the resident DSH composer without stealing a later user choice: Team
    // data can load after navigation, so a dialog or another control may already
    // own focus by the time this composer appears.
    useEffect(() => {
        const active = document.activeElement;
        if (active !== document.body && active?.closest('[aria-current="page"]') === null)
            return;
        inputRef.current?.focus({ preventScroll: true });
    }, []);
    // Confirmation settles after a read-only submission span. Restore focus in
    // case the browser moved it so the second Enter can confirm immediately.
    useEffect(() => {
        if (confirmation === undefined || pending)
            return;
        inputRef.current?.focus({ preventScroll: true });
    }, [confirmation, pending]);
    // Handle lookup for both directions of the same judgement: whether a picked
    // recipient is still spelled in the text, and which Members the text names.
    const memberHandles = new Map(members.map(status => [status.member.memberId, status.member.handle]));
    const pruneRecipients = (nextDraft) => {
        // An @all marker stands for its expansion snapshot: the member handles it
        // stands for are not in the text, so text-based pruning must stand down.
        if (containsAllMention(nextDraft))
            return;
        const next = new Set([...recipients].filter(memberId => {
            const handle = memberHandles.get(memberId);
            return handle !== undefined && containsMention(nextDraft, handle);
        }));
        if (next.size !== recipients.size)
            drafts.writeRecipients(draftKey, next);
    };
    // Restored drafts may carry recipients that no longer match the text (or
    // unknown Members); converge on mount and on every state change so the
    // cached entry never stays stale — the same rule user edits already apply.
    // An unloaded roster must never judge recipients unknown.
    useEffect(() => {
        if (members.length === 0)
            return;
        pruneRecipients(draft);
    }, [draft, recipients, members]);
    // The notify row reports what the Host will resolve from this draft, not just
    // what the mention menu picked: an authored `@Handle` delivers exactly like a
    // pick, and `@all` stands for the menu's expansion.
    const notifiedIds = [...new Set([...recipients, ...mentionedMemberIds(draft, members)])].sort();
    const updateMention = (nextDraft, caret) => {
        const match = findMention(nextDraft, caret);
        setMention(match);
        if (match === undefined)
            setHighlight(0);
    };
    const onChange = (event) => {
        const nextDraft = event.target.value;
        drafts.writeDraft(draftKey, nextDraft);
        onEdit?.();
        pruneRecipients(nextDraft);
        updateMention(nextDraft, event.target.selectionStart ?? nextDraft.length);
    };
    // Both pick kinds share the same commit path: swap the text in, add the
    // recipients, close the menu, and restore the caret after focus.
    const commitMention = (nextDraft, nextCaret, nextRecipients) => {
        drafts.writeDraft(draftKey, nextDraft);
        drafts.writeRecipients(draftKey, nextRecipients);
        onEdit?.();
        setMention(undefined);
        setHighlight(0);
        requestAnimationFrame(() => {
            const input = inputRef.current;
            if (input === null)
                return;
            input.focus({ preventScroll: true });
            input.setSelectionRange(nextCaret, nextCaret);
        });
    };
    const selectOption = (option) => {
        if (mention === undefined)
            return;
        if (option.kind === 'all') {
            // Expand at pick time: the recipients snapshot is every eligible member
            // a handle pick could reach at this moment.
            const nextDraft = `${draft.slice(0, mention.start)}@all ${draft.slice(mention.end)}`;
            const nextCaret = mention.start + '@all '.length;
            const nextRecipients = new Set(recipients);
            for (const status of allMentionMembers(members))
                nextRecipients.add(status.member.memberId);
            commitMention(nextDraft, nextCaret, nextRecipients);
            return;
        }
        const member = option.status;
        const inserted = `@${member.member.handle} `;
        const nextDraft = `${draft.slice(0, mention.start)}${inserted}${draft.slice(mention.end)}`;
        const nextCaret = mention.start + inserted.length;
        commitMention(nextDraft, nextCaret, new Set(recipients).add(member.member.memberId));
    };
    // Pasted files (screenshots, copies) join the same chips the "+" picker
    // fills; only a paste that carries files is intercepted, so plain text
    // keeps the browser's native insertion.
    const onPaste = (event) => {
        if (pending || onFilesChange === undefined || pendingFiles === undefined)
            return;
        const files = Array.from(event.clipboardData.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file) => file !== null);
        if (files.length === 0)
            return;
        event.preventDefault();
        onFilesChange([...pendingFiles, ...files]);
    };
    const onKeyDown = (event) => {
        const composing = composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
        if (menuOpen && event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight(current => (current + 1) % options.length);
            return;
        }
        if (menuOpen && event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight(current => (current - 1 + options.length) % options.length);
            return;
        }
        if (event.key === 'Escape' && menuOpen) {
            event.preventDefault();
            setMention(undefined);
            return;
        }
        // Tab accepts the highlighted candidate; Shift+Tab keeps default focus reversal.
        if (menuOpen && event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            if (activeOption !== undefined)
                selectOption(activeOption);
            return;
        }
        if (event.key !== 'Enter' || event.shiftKey || composing || event.repeat)
            return;
        if (menuOpen && activeOption !== undefined) {
            event.preventDefault();
            selectOption(activeOption);
            return;
        }
        event.preventDefault();
        if (!pending && draft.trim() !== '')
            onSubmit();
    };
    return _jsxs("form", { ref: rootRef, className: css.root, onSubmit: event => {
            event.preventDefault();
            if (!pending && draft.trim() !== '')
                onSubmit();
        }, children: [_jsxs("div", { className: css.card, "data-team-composer": true, children: [confirmation !== undefined && _jsx("p", { className: css.confirmation, role: "status", children: confirmation }), _jsxs("div", { className: css.inputArea, children: [menuOpen && _jsx("div", { id: listId, ref: menuRef, className: css.mentionMenu, role: "listbox", "aria-label": t('mentionSuggestions'), style: { maxHeight: menuMaxHeight }, children: options.map((option, index) => {
                                    const optionId = option.kind === 'all' ? `${listId}-all` : `${listId}-${option.status.member.memberId}`;
                                    const selected = index === highlight;
                                    return option.kind === 'all'
                                        ? _jsxs("button", { id: optionId, type: "button", role: "option", "aria-selected": selected, className: css.mentionOption, ref: selected ? activeOptionRef : undefined, onMouseDown: event => { event.preventDefault(); }, onClick: () => { selectOption(option); }, children: [_jsx("span", { className: css.mentionAllDot, "aria-hidden": "true" }), _jsx("span", { className: css.mentionName, children: "@all" }), _jsx("span", { className: css.mentionDescription, children: t('mentionAll', { count: allCount }) })] }, "all")
                                        : _jsxs("button", { id: optionId, type: "button", role: "option", "aria-selected": selected, className: css.mentionOption, ref: selected ? activeOptionRef : undefined, onMouseDown: event => { event.preventDefault(); }, onClick: () => { selectOption(option); }, children: [_jsx(TeamPresenceDot, { status: option.status, t: t }), _jsxs("span", { className: css.mentionName, children: ["@", option.status.member.handle] }), _jsx("span", { className: css.mentionDescription, children: option.status.member.description })] }, option.status.member.memberId);
                                }) }), _jsx("textarea", { ref: inputRef, "aria-label": t('messageDraft'), "aria-autocomplete": "list", "aria-controls": menuOpen ? listId : undefined, "aria-activedescendant": menuOpen && activeOption !== undefined ? activeOption.kind === 'all' ? `${listId}-all` : `${listId}-${activeOption.status.member.memberId}` : undefined, "aria-expanded": menuOpen, value: draft, readOnly: pending, placeholder: placeholder ?? t('messagePlaceholder'), rows: 1, onChange: onChange, onPaste: onPaste, onKeyDown: onKeyDown, onSelect: event => { updateMention(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length); }, onCompositionStart: () => { composingRef.current = true; }, onCompositionEnd: () => { setTimeout(() => { composingRef.current = false; }, 10); } })] }), notifiedIds.length > 0 && _jsx("p", { className: css.notifyRow, "data-team-notify": true, children: t('composerNotify', { ids: notifiedIds.map(memberId => `@${memberHandles.get(memberId) ?? memberId}`).join(', ') }) }), onFilesChange !== undefined && pendingFiles !== undefined && pendingFiles.length > 0 && (_jsx("ul", { className: css.fileChips, "aria-label": t('attachFiles'), children: pendingFiles.map((file, index) => {
                            const previewUrl = draftPreviewUrl(file);
                            return _jsxs("li", { className: `${css.fileChip} ${previewUrl !== undefined ? css.imageChip : ''}`, children: [previewUrl !== undefined && _jsx("img", { src: previewUrl, alt: "", className: css.imageChipPreview }), _jsxs("span", { className: css.fileChipName, title: file.name, children: [file.name, _jsx("span", { className: css.fileChipSize, children: formatByteSize(file.size) })] }), _jsx("button", { type: "button", className: css.fileChipRemove, "aria-label": t('removeFile', { name: file.name }), disabled: pending, onClick: () => {
                                            const url = draftPreviewUrls.get(file);
                                            if (url !== undefined)
                                                URL.revokeObjectURL(url);
                                            onFilesChange(pendingFiles.filter((_, candidate) => candidate !== index));
                                        }, children: "\u00D7" })] }, `${file.name}-${index}`);
                        }) })), _jsxs("div", { className: css.toolbar, children: [onFilesChange !== undefined && (_jsxs(_Fragment, { children: [_jsx("input", { ref: fileInputRef, type: "file", multiple: true, className: css.fileInput, "aria-hidden": "true", tabIndex: -1, onChange: event => {
                                            const chosen = [...event.target.files ?? []];
                                            if (chosen.length > 0 && pendingFiles !== undefined)
                                                onFilesChange([...pendingFiles, ...chosen]);
                                            event.target.value = '';
                                        } }), _jsx(Tooltip, { label: t('attachFiles'), side: "top", delayMs: 500, children: _jsx("button", { type: "button", className: css.attachButton, "aria-label": t('attachFiles'), disabled: pending, onClick: () => { fileInputRef.current?.click(); }, children: _jsx(IconPaperclipOutlineMedium, { size: 14 }) }) })] })), onAsTaskChange !== undefined && (_jsxs("button", { type: "button", className: asTask === true ? `${css.asTaskPill} ${css.asTaskPillOn}` : css.asTaskPill, "aria-label": t('asTask'), "aria-pressed": asTask === true, title: t('asTask'), disabled: pending, onClick: () => { onAsTaskChange(asTask !== true); }, children: [_jsx(IconChecklistOutlineMedium, { size: 14 }), _jsx("span", { className: css.asTaskLabel, children: t('asTask') })] })), _jsx("button", { type: "submit", className: css.sendButton, "aria-label": pending ? t('sendingMessage') : t('sendMessage'), disabled: pending || draft.trim() === '', onMouseDown: event => {
                                    // Keep the composer focused when the send control is clicked.
                                    event.preventDefault();
                                    inputRef.current?.focus({ preventScroll: true });
                                }, children: _jsx(IconSendOutlineRegular, { size: 16 }) })] })] }), error !== undefined && _jsx("p", { className: css.error, role: "alert", children: error })] });
}
