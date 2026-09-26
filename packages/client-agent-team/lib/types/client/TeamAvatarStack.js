import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAvatarImage } from "./avatar-image.js";
import { memberHue } from "./team-formatters.js";
import css from './avatar-stack.module.css';
/** Distinct owners past this count collapse into one `+N` chip. */
const MAX_VISIBLE = 3;
/**
 * Owners as a seat names them: the Client's Human identity outranks the name
 * the Host projected for that actor, so a rename moves label and initial
 * together in every seat that draws the stack.
 */
export function namedAvatarOwners(owners, human) {
    if (human === undefined)
        return owners;
    return owners.map(owner => owner.memberId === human.memberId ? { memberId: owner.memberId, name: human.name } : owner);
}
/**
 * The compact "who is on this work" stack: overlapping 18px Member circles in
 * the shared identity language, capped at three plus a `+N` chip. The circles
 * are presentational, so the stack is one `role="img"` whose label carries the
 * whole roster — three anonymous initials would read as noise.
 */
export function TeamAvatarStack({ owners, label, human }) {
    if (owners.length === 0)
        return null;
    const shown = owners.slice(0, MAX_VISIBLE);
    const overflow = owners.length - shown.length;
    return _jsxs("span", { className: css.stack, role: "img", "aria-label": label, children: [shown.map(owner => _jsx(OwnerAvatar, { owner: owner, human: human }, owner.memberId)), overflow > 0 && _jsx("span", { className: css.overflow, children: `+${overflow}` })] });
}
/**
 * One circle. Only an owner the seat identifies as the Human consults an image
 * at all, and those bytes keep the initial whenever they do not decode — the
 * same promise, and the same hook, the timeline avatar makes.
 */
function OwnerAvatar({ owner, human }) {
    const image = useAvatarImage(human !== undefined && owner.memberId === human.memberId ? human.avatarUrl : undefined);
    const hue = { '--team-avatar-hue': memberHue(owner.memberId) };
    if (image.src === undefined)
        return _jsx("span", { className: css.avatar, style: hue, children: initial(owner.name) });
    return _jsx("img", { className: css.avatarImage, style: hue, src: image.src, alt: "", "aria-hidden": "true", onError: image.failed });
}
/** First visible character of a handle — and of a raw Member id when that is all there is. */
function initial(name) {
    return name.replace(/^@/, '').replace(/^member:/, '').slice(0, 1).toUpperCase();
}
