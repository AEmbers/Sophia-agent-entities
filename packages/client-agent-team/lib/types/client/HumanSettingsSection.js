import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { useHumanIdentity } from "./human-identity.js";
import { useAvatarImage } from "./avatar-image.js";
import css from './human-settings.module.css';
/**
 * The Human's own settings page: display name, avatar, and the version
 * footnote.
 *
 * The page owns no durable fact and no copy of one. Name, avatar, and version
 * all arrive from the shared identity projection, so a save here moves the
 * message rows and member refs at the same moment; a failed write keeps the
 * typed name in the field and reports the Host's own reason.
 */
/** Host-side avatar ceiling (`ATTACHMENT_MAX_BYTES`): the settings page refuses larger files before the round trip. */
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Run one durable write and reduce every failure to the message the page
 * reports. A rejected Remote call (a dropped carrier, a refused write) is a
 * failure like any other: without this the field would sit on "saving" forever
 * and report nothing.
 */
async function failureOf(action) {
    try {
        return await action();
    }
    catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}
/** First visible character of a display name, or the neutral `H` before one is known. */
function avatarInitial(name) {
    const trimmed = (name ?? '').replace(/^@/, '').trim();
    return trimmed === '' ? 'H' : trimmed.slice(0, 1).toUpperCase();
}
export function HumanSettingsSection(props) {
    const { t, identity } = props;
    const profile = useHumanIdentity(identity);
    // Undefined means "follow the Host value": the field re-syncs whenever the
    // profile changes underneath, without a background read clobbering a name
    // the reader is still editing.
    const [draft, setDraft] = useState(undefined);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [notice, setNotice] = useState(null);
    const filePicker = useRef(null);
    const name = draft ?? profile.name ?? '';
    const dirty = draft !== undefined && draft.trim() !== (profile.name ?? '');
    const emptyName = draft !== undefined && draft.trim() === '';
    const hasAvatar = profile.avatarRef !== undefined;
    // The circle answers to decoded bytes, not to a stored reference: the Host
    // accepts any `image/…` payload, so a file this browser cannot read has to
    // fall back to the initial exactly as a removed one does.
    const avatar = useAvatarImage(profile.avatarUrl);
    const submitName = async () => {
        if (!dirty || emptyName || saving)
            return;
        setSaving(true);
        setNotice(null);
        const failure = await failureOf(() => props.saveName(name.trim()));
        setSaving(false);
        if (failure !== undefined) {
            setNotice(t('humanSettingsNameFailed', { message: failure }));
            return;
        }
        setDraft(undefined);
    };
    const pickAvatar = async (file) => {
        if (file === undefined)
            return;
        setNotice(null);
        if (!file.type.startsWith('image/')) {
            setNotice(t('humanSettingsAvatarNotImage'));
            return;
        }
        if (file.size > AVATAR_MAX_BYTES) {
            setNotice(t('humanSettingsAvatarTooLarge'));
            return;
        }
        setUploading(true);
        const failure = await failureOf(() => props.uploadAvatar(file));
        setUploading(false);
        if (failure !== undefined)
            setNotice(t('humanSettingsAvatarFailed', { message: failure }));
    };
    const removeAvatar = async () => {
        setNotice(null);
        const failure = await failureOf(() => props.removeAvatar());
        if (failure !== undefined)
            setNotice(t('humanSettingsAvatarFailed', { message: failure }));
    };
    // The page says what it is before it says what happened: the settings nav
    // lists it beside the Harness's own pages, so the title alone leaves "whose
    // profile is this, and where does it apply?" unanswered — and every state,
    // including a failed read, has to answer it.
    const pageHeader = _jsxs(_Fragment, { children: [_jsx("h2", { className: css.heading, children: t('humanSettingsTitle') }), _jsx("p", { className: css.intro, children: t('humanSettingsIntro') })] });
    if (profile.status === 'loading' && profile.name === undefined) {
        return _jsxs("div", { className: css.section, children: [pageHeader, _jsx("p", { className: css.state, role: "status", children: t('humanSettingsLoading') })] });
    }
    if (profile.name === undefined) {
        return _jsxs("div", { className: css.section, children: [pageHeader, _jsx("p", { className: css.state, role: "alert", children: t('humanSettingsUnavailable', { message: profile.error ?? '' }) }), _jsx("div", { className: css.stateAction, children: _jsx(Button, { variant: "outline", onClick: () => { void identity.refresh(); }, children: t('retry') }) })] });
    }
    return (_jsxs("div", { className: css.section, children: [pageHeader, _jsxs("div", { className: css.rows, children: [_jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t('humanSettingsName') }), _jsx("div", { className: css.desc, children: t('humanSettingsNameHint') })] }), _jsxs("form", { className: css.controls, onSubmit: (event) => {
                                    event.preventDefault();
                                    void submitName();
                                }, children: [_jsx(Input, { className: css.nameInput, "aria-label": t('humanSettingsName'), "aria-invalid": emptyName || undefined, value: name, disabled: saving, onChange: (event) => { setDraft(event.target.value); } }), _jsx(Button, { type: "submit", variant: "primary", disabled: saving || !dirty || emptyName, children: saving ? t('humanSettingsSaving') : t('humanSettingsSave') })] })] }), _jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t('humanSettingsAvatar') }), _jsx("div", { className: css.desc, children: t('humanSettingsAvatarHint') })] }), _jsxs("div", { className: css.controls, children: [avatar.src === undefined
                                        ? _jsx("span", { className: `${css.identity} ${css.identityFallback}`, "data-avatar": "initial", "aria-hidden": "true", children: avatarInitial(profile.name) })
                                        : _jsx("img", { className: `${css.identity} ${css.identityImage}`, "data-avatar": "image", src: avatar.src, alt: "", onError: avatar.failed }), _jsx("input", { ref: filePicker, type: "file", accept: "image/*", tabIndex: -1, "aria-hidden": "true", hidden: true, onChange: (event) => {
                                            void pickAvatar(event.target.files?.[0]);
                                            event.target.value = '';
                                        } }), _jsx(Button, { variant: "outline", disabled: uploading, onClick: () => { filePicker.current?.click(); }, children: uploading ? t('humanSettingsUploading') : hasAvatar ? t('humanSettingsReplace') : t('humanSettingsUpload') }), hasAvatar && _jsx(Button, { disabled: uploading, onClick: () => { void removeAvatar(); }, children: t('humanSettingsRemoveAvatar') })] })] })] }), _jsxs("div", { className: css.footnote, children: [_jsx("span", { children: t('humanSettingsVersion', { version: profile.version ?? '' }) }), _jsx("span", { "aria-hidden": "true", children: "\u00B7" }), _jsx("a", { className: css.link, href: profile.repoUrl ?? '', target: "_blank", rel: "noreferrer", children: "GitHub" }), profile.updateAvailable && profile.latestVersion !== undefined
                        ? _jsx("a", { className: css.link, href: `${profile.repoUrl ?? ''}/releases`, target: "_blank", rel: "noreferrer", children: t('humanSettingsUpdateAvailable', { version: profile.latestVersion }) })
                        : null] }), emptyName && _jsx("p", { className: css.notice, children: t('humanSettingsNameEmpty') }), notice === null ? null : _jsx("p", { className: css.notice, role: "alert", children: notice })] }));
}
