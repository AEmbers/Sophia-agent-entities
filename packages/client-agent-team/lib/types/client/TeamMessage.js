import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { cachedAttachmentDataUrl, formatByteSize, loadAttachmentDataUrl } from "./attachment-preview.js";
import { cachedResolvedTaskRef, resolveUnknownTaskRefs, useResolvedTaskRefVersion } from "./refs.js";
import { cachedResolvedThreadRef, resolveUnknownThreadRefs, useResolvedThreadRefVersion } from "./refs.js";
import { formatMessageTime, isSingleBrandedRef, memberHue, planMessageBody, shouldClampMessage, splitBrandedRefs, splitMentionNames } from "./team-formatters.js";
import { useAvatarImage } from "./avatar-image.js";
import css from './conversation.module.css';
/**
 * One chat message row with identity chrome and sender-appropriate rendering.
 *
 * Memoized because a timeline row is rendered by the page that owns the whole
 * Thread: the Task-ref subscription below lives inside this component, so
 * skipping a render here never detaches it. Callers must therefore keep the
 * props they derive per render (mention names, ref callbacks) identity-stable.
 */
export const TeamMessage = memo(function TeamMessage({ senderName, memberId, human, avatarUrl, body, occurredAt, mentionNames, senderTitle, grouped, showGroupedTime, attachments, loadAttachment, t, onOpenRef, onResolveTaskRefs, onResolveThreadRefs, channelNameOf, memberOf, onOpenMemberSession, children }) {
    const avatarStyle = human ? undefined : { '--team-avatar-hue': memberHue(memberId) };
    // Only the Human's own row may draw a picture: the profile owns those bytes,
    // and one seat painting the reader's face for another author would name two
    // people alike. A seat draws it while those bytes decode; anything else keeps
    // the initial, which is what the fallback promises.
    const identityImage = useAvatarImage(human ? avatarUrl : undefined);
    // Literal bodies carry mention chips inline — Human input always, and
    // plain-prose Agent bodies where literal rendering loses nothing. Rich
    // Markdown keeps unmatched structured mentions in the trailing row.
    // The stored body carries machine-facing `[attachment] <path>` prompt lines;
    // humans see the attachment strip rendered from the message metadata instead.
    // One pure plan resolves the stored body into the rendering branch, the
    // trailing fallback rows, and the literal Task/Thread refs that resolve in place.
    const plan = planMessageBody(body, { human, ...(mentionNames === undefined ? {} : { mentionNames }), canOpenRefs: onOpenRef !== undefined });
    const displayBody = plan.displayBody;
    const { richAgentBody } = plan;
    // Resolved refs re-label once the Host lookup lands; the version tokens
    // refresh literal links and rendered Markdown prose.
    const taskRefVersion = useResolvedTaskRefVersion();
    const threadRefVersion = useResolvedThreadRefVersion();
    const bodyTaskRefs = plan.taskRefs;
    const bodyTaskRefKey = bodyTaskRefs.join(',');
    const bodyThreadRefs = plan.threadRefs;
    const bodyThreadRefKey = bodyThreadRefs.join(',');
    useEffect(() => {
        if (onResolveTaskRefs !== undefined && bodyTaskRefKey !== '')
            void resolveUnknownTaskRefs(bodyTaskRefs, onResolveTaskRefs);
        if (onResolveThreadRefs !== undefined && bodyThreadRefKey !== '')
            void resolveUnknownThreadRefs(bodyThreadRefs, onResolveThreadRefs);
    }, [onResolveTaskRefs, onResolveThreadRefs, bodyTaskRefKey, bodyThreadRefKey, taskRefVersion, threadRefVersion]);
    const taskLabel = useCallback((taskNumber) => t?.('taskLabel', { number: taskNumber }) ?? `Task #${taskNumber}`, [t]);
    // Thread chips carry the cited Thread's opening-line gist, so one taskless
    // Thread no longer reads exactly like the next. Unresolvable refs never
    // reach this label — they stay plain text (see renderRefs).
    const threadChipLabel = useCallback((title) => {
        const base = t?.('threadLabel') ?? 'Thread';
        return title === '' ? base : `${base} · ${title}`;
    }, [t]);
    // Channel chips name the cited Channel; member chips name the cited Member
    // with a handle — deliberately distinct from `@mention` chips, which notify.
    const channelChipLabel = useCallback((name) => t?.('channelLabel', { name }) ?? `Channel · ${name}`, [t]);
    const memberChipLabel = useCallback((name) => t?.('memberLabel', { name }) ?? `Member · @${name}`, [t]);
    // Markdown chrome (code-copy buttons, footnotes heading) is locale copy the
    // cordis-free primitive receives via props. Stable per locale revision — a
    // fresh object per render would rebuild the component table every chunk.
    const markdownLabels = useMemo(() => ({
        code: { copyLabel: t?.('copyCode') ?? 'Copy', copiedLabel: t?.('copiedCode') ?? 'Copied' },
        footnotes: t?.('markdownFootnotes') ?? 'Footnotes',
    }), [t]);
    // Long bodies start clamped behind the expand control. The default derives
    // from the body alone; the toggle itself is per-mount view state nothing
    // persists.
    const [expanded, setExpanded] = useState(false);
    const clampable = shouldClampMessage(displayBody);
    const clamped = clampable && !expanded;
    const markdownRef = useRef(null);
    useLayoutEffect(() => {
        const root = markdownRef.current;
        if (!richAgentBody || root === null || onOpenRef === undefined)
            return;
        const textNodes = markdownProseTextNodes(root);
        const styledRefCodes = markdownStyledRefCodeElements(root);
        const taskRefs = [...new Set([...textNodes.map(node => node.data), ...styledRefCodes.map(code => code.textContent ?? '')]
                .flatMap(text => splitBrandedRefs(text)
                .filter(segment => segment.ref?.startsWith('task:') === true)
                .map(segment => segment.ref)))];
        const threadRefs = [...new Set([...textNodes.map(node => node.data), ...styledRefCodes.map(code => code.textContent ?? '')]
                .flatMap(text => splitBrandedRefs(text)
                .filter(segment => segment.ref?.startsWith('thread:') === true)
                .map(segment => segment.ref)))];
        if (onResolveTaskRefs !== undefined && taskRefs.length > 0)
            void resolveUnknownTaskRefs(taskRefs, onResolveTaskRefs);
        if (onResolveThreadRefs !== undefined && threadRefs.length > 0)
            void resolveUnknownThreadRefs(threadRefs, onResolveThreadRefs);
        for (const code of styledRefCodes)
            renderResolvedMarkdownCodeRef(code, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf);
        for (const node of textNodes)
            renderResolvedMarkdownText(node, mentionNames ?? [], taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf);
        for (const button of root.querySelectorAll('button[data-task-ref]')) {
            const taskRef = button.dataset.taskRef;
            const hit = taskRef === undefined ? undefined : cachedResolvedTaskRef(taskRef);
            if (taskRef !== undefined && hit !== undefined)
                button.textContent = taskLabel(hit.taskNumber);
        }
        for (const button of root.querySelectorAll('button[data-thread-ref]')) {
            const threadRef = button.dataset.threadRef;
            const hit = threadRef === undefined ? undefined : cachedResolvedThreadRef(threadRef);
            if (threadRef !== undefined && hit !== undefined)
                button.textContent = threadChipLabel(hit.title);
        }
    }, [richAgentBody, onOpenRef, onResolveTaskRefs, onResolveThreadRefs, taskRefVersion, threadRefVersion, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf, mentionNames]);
    useEffect(() => {
        const root = markdownRef.current;
        if (!richAgentBody || root === null || onOpenRef === undefined)
            return;
        const openTask = (event) => {
            const target = event.target;
            if (!(target instanceof Element))
                return;
            const button = target.closest('button[data-ref], button[data-task-ref], button[data-thread-ref], button[data-member-session]');
            if (button === null || !root.contains(button))
                return;
            if (button instanceof HTMLElement) {
                // Member chips carry their session, not a Team ref: the same jump
                // the agent card performs. Every other chip resolves to onOpenRef.
                const sessionId = button.dataset.memberSession;
                if (sessionId !== undefined) {
                    onOpenMemberSession?.(sessionId);
                    return;
                }
                const ref = button.dataset.ref ?? button.dataset.taskRef ?? button.dataset.threadRef;
                if (ref !== undefined)
                    onOpenRef(ref);
            }
        };
        root.addEventListener('click', openTask);
        return () => { root.removeEventListener('click', openTask); };
    }, [richAgentBody, onOpenRef, onOpenMemberSession]);
    const bodyNode = plan.render === 'inline' && plan.inline !== undefined
        ? _jsx("div", { className: css.messageText, children: plan.inline.segments.map((segment, index) => segment.mention
                ? _jsx("span", { className: css.mention, children: segment.text }, index)
                : _jsx(Fragment, { children: renderRefs(segment.text, onOpenRef, onOpenMemberSession, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf) }, index)) })
        : plan.render === 'literal'
            ? _jsx("div", { className: css.messageText, children: onOpenRef === undefined ? displayBody : renderRefs(displayBody, onOpenRef, onOpenMemberSession, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf) })
            : _jsx("div", { ref: markdownRef, className: css.messageMarkdown, children: _jsx(MarkdownText, { text: displayBody, labels: markdownLabels }, `${displayBody}:${onOpenRef === undefined ? 'literal' : 'refs'}`) });
    return (_jsxs("article", { className: css.messageRow, "data-human": human || undefined, "data-grouped": grouped || undefined, children: [identityImage.src === undefined
                ? _jsx("div", { className: css.messageIdentity, "data-avatar": "initial", style: avatarStyle, "aria-hidden": "true", children: senderName.replace('@', '').slice(0, 1).toUpperCase() })
                : _jsx("img", { className: css.messageIdentityImage, "data-avatar": "image", src: identityImage.src, alt: "", "aria-hidden": "true", onError: identityImage.failed }), _jsxs("div", { className: css.messageBody, children: [(!grouped || showGroupedTime === true) && (_jsxs("div", { className: css.nameRow, children: [!grouped && _jsx("strong", { ...(senderTitle === undefined ? {} : { title: senderTitle }), children: senderName }), occurredAt !== undefined && _jsx("span", { className: css.messageTime, children: formatMessageTime(occurredAt) })] })), clampable ? _jsx("div", { "data-document": "", className: clamped ? css.messageClamp : undefined, children: bodyNode }) : bodyNode, clampable && (_jsx("button", { type: "button", className: css.messageExpand, "data-message-expand": "true", "aria-expanded": expanded, onClick: () => { setExpanded(value => !value); }, children: expanded ? (t?.('collapseMessage') ?? 'Show less') : (t?.('expandMessage') ?? 'Show more') })), (plan.fallbackNames.length > 0 || plan.fallbackRefs.length > 0) && (_jsxs("div", { className: css.mentionsRow, children: [plan.fallbackNames.map(name => _jsxs("span", { className: css.mention, children: ["@", name] }, name)), plan.fallbackRefs.map(ref => {
                                const resolved = cachedResolvedTaskRef(ref);
                                const label = resolved !== undefined && ref.startsWith('task:') ? taskLabel(resolved.taskNumber) : ref;
                                return _jsx("button", { type: "button", className: css.refLink, title: ref, onClick: () => { onOpenRef(ref); }, children: label }, ref);
                            })] })), attachments !== undefined && attachments.length > 0 && _jsx(TeamAttachmentStrip, { attachments: attachments, ...(loadAttachment === undefined ? {} : { loadAttachment }), ...(t === undefined ? {} : { t }) }), children] })] }));
});
/** Text nodes that Markdown rendered as prose rather than code or a link. */
function markdownProseTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent === null)
            continue;
        if (parent.closest('code, pre, a, button') !== null)
            continue;
        // Mention chips from an earlier pass stay untouched, or each effect rerun
        // would wrap another chip around the last one.
        if (css.mention !== undefined && parent.closest(`[class~="${css.mention}"]`) !== null)
            continue;
        nodes.push(node);
    }
    return nodes;
}
/** Code spans whose entire content is one branded ref: model styling around a ref, not code. */
function markdownStyledRefCodeElements(root) {
    const elements = [];
    for (const code of root.querySelectorAll('code')) {
        if (code.closest('pre, a, button') !== null)
            continue;
        if (!isSingleBrandedRef(code.textContent ?? ''))
            continue;
        elements.push(code);
    }
    return elements;
}
/** One resolved Task-ref chip built outside React, matching the styled ref link. */
function resolvedTaskRefButton(taskRef, label) {
    const button = document.createElement('button');
    button.type = 'button';
    if (css.refLink !== undefined)
        button.className = css.refLink;
    button.dataset.taskRef = taskRef;
    button.title = taskRef;
    button.textContent = label;
    return button;
}
/** One resolved Thread-ref chip built outside React, matching the styled ref link. */
function resolvedThreadRefButton(threadRef, label) {
    const button = document.createElement('button');
    button.type = 'button';
    if (css.refLink !== undefined)
        button.className = css.refLink;
    button.dataset.threadRef = threadRef;
    button.title = threadRef;
    button.textContent = label;
    return button;
}
/** One roster-resolved Channel chip built outside React, matching the styled ref link. */
function resolvedChannelRefButton(channelRef, label) {
    const button = document.createElement('button');
    button.type = 'button';
    if (css.refLink !== undefined)
        button.className = css.refLink;
    button.dataset.ref = channelRef;
    button.title = channelRef;
    button.textContent = label;
    return button;
}
/**
 * One roster-resolved Member chip built outside React. Openable Members jump
 * to their session through the delegated click listener; everyone else gets
 * a labelled but inert span, never a link-shaped misfire.
 */
function resolvedMemberRefChip(memberRef, label, sessionId) {
    if (sessionId === undefined) {
        const span = document.createElement('span');
        span.title = memberRef;
        span.textContent = label;
        return span;
    }
    const button = document.createElement('button');
    button.type = 'button';
    if (css.refLink !== undefined)
        button.className = css.refLink;
    button.dataset.memberSession = sessionId;
    button.title = memberRef;
    button.textContent = label;
    return button;
}
/** Replace a whole-ref code span with its resolved chip once known. */
function renderResolvedMarkdownCodeRef(code, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf) {
    const segments = splitBrandedRefs((code.textContent ?? '').trim());
    const segment = segments.length === 1 ? segments[0] : undefined;
    const ref = segment?.ref;
    if (ref === undefined)
        return;
    // Task and Thread refs need Host resolution before becoming human-readable
    // links; Channel and Member refs resolve against the loaded rosters, and
    // anything the roster does not know stays untouched plain text.
    if (ref.startsWith('task:')) {
        const resolved = cachedResolvedTaskRef(ref);
        if (resolved === undefined)
            return;
        code.replaceWith(resolvedTaskRefButton(ref, taskLabel(resolved.taskNumber)));
        return;
    }
    if (ref.startsWith('thread:')) {
        const resolved = cachedResolvedThreadRef(ref);
        if (resolved === undefined)
            return;
        code.replaceWith(resolvedThreadRefButton(ref, threadChipLabel(resolved.title)));
        return;
    }
    if (ref.startsWith('channel:')) {
        const name = channelNameOf?.(ref);
        if (name === undefined)
            return;
        code.replaceWith(resolvedChannelRefButton(ref, channelChipLabel(name)));
        return;
    }
    if (ref.startsWith('member:')) {
        const resolved = memberOf?.(ref);
        if (resolved === undefined)
            return;
        code.replaceWith(resolvedMemberRefChip(ref, memberChipLabel(resolved.handle), resolved.openable ? resolved.sessionId : undefined));
    }
}
/** Replace resolved Task/Thread/Channel/Member refs and structured mention handles in one prose text node without changing Markdown structure. */
function renderResolvedMarkdownText(node, mentionNames, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf) {
    let changed = false;
    const fragment = document.createDocumentFragment();
    for (const refSegment of splitBrandedRefs(node.data)) {
        if (refSegment.ref === undefined) {
            for (const mentionSegment of splitMentionNames(refSegment.text, mentionNames).segments) {
                if (!mentionSegment.mention) {
                    fragment.append(mentionSegment.text);
                    continue;
                }
                changed = true;
                const chip = document.createElement('span');
                if (css.mention !== undefined)
                    chip.className = css.mention;
                chip.textContent = mentionSegment.text;
                fragment.append(chip);
            }
            continue;
        }
        // Task and Thread refs need Host resolution before becoming human-readable
        // links; Channel and Member refs resolve against the loaded rosters.
        // Unresolvable refs stay plain text so prose never misfires as a link.
        if (refSegment.ref.startsWith('task:')) {
            const resolved = cachedResolvedTaskRef(refSegment.ref);
            if (resolved === undefined) {
                fragment.append(refSegment.text);
                continue;
            }
            changed = true;
            fragment.append(resolvedTaskRefButton(refSegment.ref, taskLabel(resolved.taskNumber)));
        }
        else if (refSegment.ref.startsWith('thread:')) {
            const resolved = cachedResolvedThreadRef(refSegment.ref);
            if (resolved === undefined) {
                fragment.append(refSegment.text);
                continue;
            }
            changed = true;
            fragment.append(resolvedThreadRefButton(refSegment.ref, threadChipLabel(resolved.title)));
        }
        else if (refSegment.ref.startsWith('channel:')) {
            const name = channelNameOf?.(refSegment.ref);
            if (name === undefined) {
                fragment.append(refSegment.text);
                continue;
            }
            changed = true;
            fragment.append(resolvedChannelRefButton(refSegment.ref, channelChipLabel(name)));
        }
        else if (refSegment.ref.startsWith('member:')) {
            const resolved = memberOf?.(refSegment.ref);
            if (resolved === undefined) {
                fragment.append(refSegment.text);
                continue;
            }
            changed = true;
            fragment.append(resolvedMemberRefChip(refSegment.ref, memberChipLabel(resolved.handle), resolved.openable ? resolved.sessionId : undefined));
        }
        else {
            fragment.append(refSegment.text);
        }
    }
    if (changed)
        node.replaceWith(fragment);
}
/** Render one literal text run, linkifying branded refs when navigation is available. */
function renderRefs(text, onOpenRef, onOpenMemberSession, taskLabel, threadChipLabel, channelChipLabel, memberChipLabel, channelNameOf, memberOf) {
    if (onOpenRef === undefined)
        return text;
    return splitBrandedRefs(text).map((segment, index) => {
        if (segment.ref === undefined)
            return _jsx(Fragment, { children: segment.text }, index);
        // Task and Thread refs link only once the Host confirms them; Channel and
        // Member refs link once the loaded roster knows them. Anything unknown
        // stays plain text so prose never misfires as a link.
        if (segment.ref.startsWith('task:')) {
            const resolved = cachedResolvedTaskRef(segment.ref);
            if (resolved === undefined)
                return _jsx(Fragment, { children: segment.text }, index);
            return _jsx("button", { type: "button", className: css.refLink, title: segment.ref, onClick: () => { onOpenRef(segment.ref); }, children: taskLabel(resolved.taskNumber) }, index);
        }
        if (segment.ref.startsWith('thread:')) {
            const resolved = cachedResolvedThreadRef(segment.ref);
            if (resolved === undefined)
                return _jsx(Fragment, { children: segment.text }, index);
            return _jsx("button", { type: "button", className: css.refLink, title: segment.ref, onClick: () => { onOpenRef(segment.ref); }, children: threadChipLabel(resolved.title) }, index);
        }
        if (segment.ref.startsWith('channel:')) {
            const name = channelNameOf?.(segment.ref);
            if (name === undefined)
                return _jsx(Fragment, { children: segment.text }, index);
            return _jsx("button", { type: "button", className: css.refLink, title: segment.ref, onClick: () => { onOpenRef(segment.ref); }, children: channelChipLabel(name) }, index);
        }
        if (segment.ref.startsWith('member:')) {
            const resolved = memberOf?.(segment.ref);
            if (resolved === undefined)
                return _jsx(Fragment, { children: segment.text }, index);
            // Known but not openable (suspended Members, the Human): a labelled
            // span, informative without promising a jump that cannot happen.
            if (!resolved.openable || resolved.sessionId === undefined || onOpenMemberSession === undefined) {
                return _jsx("span", { title: segment.ref, children: memberChipLabel(resolved.handle) }, index);
            }
            const sessionId = resolved.sessionId;
            return _jsx("button", { type: "button", className: css.refLink, title: segment.ref, onClick: () => { onOpenMemberSession(sessionId); }, children: memberChipLabel(resolved.handle) }, index);
        }
        return _jsx(Fragment, { children: segment.text }, index);
    });
}
/** One message's attachment strip: image thumbnails with a large view, or name chips when bytes are gone. */
function TeamAttachmentStrip({ attachments, loadAttachment, t }) {
    const [zoomed, setZoomed] = useState();
    return _jsxs("div", { className: css.attachmentStrip, children: [attachments.map(attachment => _jsx(TeamAttachment, { attachment: attachment, ...(loadAttachment === undefined ? {} : { loadAttachment }), ...(t === undefined ? {} : { t }), onZoom: setZoomed }, attachment.attachmentId)), zoomed !== undefined && _jsx(Modal, { open: true, ...(css.attachmentModal === undefined ? {} : { className: css.attachmentModal }), title: zoomed.name, closeLabel: t?.('close') ?? 'Close', onClose: () => { setZoomed(undefined); }, children: _jsx("img", { className: css.attachmentZoom, src: cachedAttachmentDataUrl(zoomed.attachmentId) ?? undefined, alt: zoomed.name }) })] });
}
function TeamAttachment({ attachment, loadAttachment, t, onZoom }) {
    const wantsPreview = loadAttachment !== undefined && attachment.mediaType.startsWith('image/');
    const [dataUrl, setDataUrl] = useState(wantsPreview ? cachedAttachmentDataUrl(attachment.attachmentId) : null);
    useEffect(() => {
        if (!wantsPreview || dataUrl !== undefined)
            return;
        let mounted = true;
        void loadAttachmentDataUrl(loadAttachment, attachment).then(url => { if (mounted)
            setDataUrl(url); });
        return () => { mounted = false; };
    }, [wantsPreview, dataUrl, loadAttachment, attachment]);
    const expired = t?.('attachmentExpired') ?? 'File no longer cached';
    if (wantsPreview && dataUrl !== null) {
        return _jsx("button", { type: "button", className: css.attachmentThumb, "aria-label": t?.('viewImage', { name: attachment.name }) ?? attachment.name, title: attachment.name, onClick: () => { onZoom(attachment); }, children: _jsx("img", { src: dataUrl, alt: attachment.name }) });
    }
    return _jsxs("span", { className: css.attachmentChip, title: wantsPreview ? expired : `${attachment.name} · ${formatByteSize(attachment.byteSize)}`, children: [_jsx("span", { className: css.attachmentChipName, children: attachment.name }), _jsx("span", { className: css.attachmentChipSize, children: wantsPreview ? expired : formatByteSize(attachment.byteSize) })] });
}
