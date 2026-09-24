/**
 * 上游 `HumanSettingsSection.tsx`（9.3KB / 218 行）的索菲亚版 —— **人类资料设置页**。
 *
 * ## 与上游的关系（先读这一段）
 *
 * **页面本体整份照抄**：`.section` / `.heading` / `.intro` / `.rows` / `.row` /
 * `.rowText` / `.title` / `.desc` / `.controls` / `.nameInput` / `.identity` /
 * `.identityImage` / `.identityFallback` / `.footnote` / `.link` / `.notice` /
 * `.state` / `.stateAction` 的**类名、层级、`data-avatar` 属性**全部与上游逐字一致
 * （类名来自同目录那份 `human-settings.module.css`）；
 * `failureOf` / `avatarInitial` / `submitName` / `pickAvatar` / `removeAvatar` /
 * `pageHeader` 与三个 return 分支（loading / unavailable / 正常）**逐字保留**。
 *
 * ## 剥掉的东西（逐项 + 上游行号 + 理由；**不静默删**）
 *
 * | 剥掉的上游功能 | 上游行号 | 理由 |
 * |---|---|---|
 * | `import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'` | 2 | 索菲亚**没有**这个包（`vendor/upstream-modules.d.ts` 里没有它的类型桩 ⇒ `tsc` 会报 TS2307），而且索菲亚的 `slots.ts` 已把「所有 `PropsRuntime` / `PropsLocale` 的宿主注入字段」写进剥除清单（宿主注入在索菲亚由**显式 prop** 代替）⇒ `HumanSettingsSectionProps` 里的那两项换成显式 `t` |
 * | `PropsRuntime<'settings.section'>`（宿主槽位的运行期注入） | 33 | 同上。索菲亚的界面由 `panel.tsx` / `seats.tsx` 直接渲染，没有宿主「设置页槽位」这一层 |
 * | `PropsLocale<'team'>`（宿主 locale 服务注入的 `t`） | 34 | 同上。索菲亚的翻译函数是**显式 prop**（形状取 `TeamConversationProps['t']`，与 `TeamSidebarProps['t']` 同形状 —— 见 `slots.ts` 那一行自己的说明） |
 * | `import { useAvatarImage } from './avatar-image.ts'` | 5 | 索菲亚**没有**这个模块（它是上游自己的实现）。同目录既有的处置是「改用索菲亚素材体系、该模块**不移植**」（`TeamMessage.tsx` 文件头的表里逐字写了同一条）。本文件因此把这个 10 行语义**内联**成页内的 `useAvatarImage`，调用点形状（`avatar.src` / `avatar.failed`）逐字保留 |
 *
 * ## ⚠ 文案：索菲亚字典**缺这批键**（如实说明 + 处置）
 *
 * 本页用到 21 个 `humanSettings*` 键。已逐条 grep 核对：索菲亚的两份字典
 * （`src/client/locales.ts` 与 `vendor/team/locales.ts`）里**一个都没有**。
 * 而本次改动**不允许**修改任何已存在的文件（规则 10，其它 agent 正在并行改这个目录）
 * ⇒ 本文件自带一份**页内兜底字典** `HUMAN_SETTINGS_COPY`：
 *
 * - 键名与上游 `locales.ts` 逐字一致（上游 114–135 行）；
 * - **值逐字照抄上游的简体中文文案**（上游 `locales.ts:115-135`，不是本文件自撰）；
 * - 取值顺序是「**宿主字典优先**：宿主 `t` 返回非空字符串就用它；否则本页兜底」，
 *   因此调用点 `t('humanSettingsTitle')` 逐字保留 —— 宿主的字典补上这批键之后，
 *   这份兜底自动让位，本文件一行不用改。
 *
 * 换句话说：这不是「发明文案」，是**把上游字典里那 21 条搬到本地**，
 * 因为共享字典本次不可改。⚠ 除这 21 条之外的键（例如 `t('retry')`）**不兜底** ——
 * 那属于接线方那份字典的责任范围（`src/client/locales.ts:44` 确实有 `retry`）。
 *
 * ## ⚠ 宿主类型桩的一个缺口（本页局部放宽，不改共享文件）
 *
 * 上游在 `<Input>` 上写了 `aria-label` 与 `aria-invalid`（无障碍用，本页必须保留）。
 * 而索菲亚的共享类型桩（`vendor/upstream-modules.d.ts` 的 `Input`）只声明了
 * `value` / `onChange` / `disabled` / `autoFocus` / `placeholder` / `className` ——
 * 那是按 `TeamMemberEditor.tsx` 的两处调用点反推的，**没有**这两个 `aria-*`。
 * 那份桩不在本次允许改动的范围内 ⇒ 本页把 `Input` **只在本页**放宽成
 * `SophiaInputProps`（见下面的注释），共享文件一行不动。
 * 桩补上这两个属性后，删掉那个断言即可回到 `const { Input } = primitives`。
 *
 * ## ⚠ 索菲亚当前**没有渲染调用点**（如实说明）
 *
 * 上游这个页面由 Client 插件注册成**宿主设置页的一个 section**
 * （上游 `index.ts:309` 注册 `humanSettingsNav` 标签、`:350` 把本组件交给
 * `ctx.slots` 的设置页槽位）。索菲亚的面板还没有设置页，`vendor/team/index.ts`
 * 也没有把本文件接进任何槽位 ⇒ **今天它不被任何地方渲染**。
 *
 * 另外，本页的数据来源（`useHumanIdentity`）在索菲亚也**还没有读面**：
 * `src/host.ts` 注册的路由里没有 `humanProfile` / `getHumanAvatar`
 * （逐条见 `human-identity.ts` 文件头）。接上它需要：
 * ① 宿主补那两个读面 + 三条写面（改名 / 上传头像 / 移除头像）；
 * ② 在 `index.ts` 里实现一个 `TeamHumanIdentityLoader` 并把 `TeamHumanIdentity` 挂上；
 * ③ 索菲亚面板补一个设置页（或设置区），把 `identity` 与三个写函数传进来。
 *
 * @module @sophia/core/client/vendor/team/HumanSettingsSection
 */

import type { ReactElement } from 'react'
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { TeamConversationProps } from './slots.ts'
import { useHumanIdentity, type TeamHumanIdentityFace } from './human-identity.ts'
import css from './human-settings.module.css'

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
const AVATAR_MAX_BYTES = 10 * 1024 * 1024

export interface HumanSettingsSectionInjected {
  /** The shared Human identity projection: profile facts plus post-write refresh. */
  identity: TeamHumanIdentityFace
  /** Persist one renamed display name; the failure message when the Host refuses it. */
  saveName: (name: string) => Promise<string | undefined>
  /** Upload one image file, persist its reference; the failure message when it does not stick. */
  uploadAvatar: (file: File) => Promise<string | undefined>
  /** Clear the avatar; the identity falls back to the initial. */
  removeAvatar: () => Promise<string | undefined>
}

/**
 * 本页的 props。
 *
 * ⚠ 上游是 `PropsRuntime<'settings.section'> & PropsLocale<'team'> & HumanSettingsSectionInjected`。
 * 前两项已剥掉（理由见文件头），换成**显式** `t`；第三项逐字保留。
 * `t` 的形状取自 `TeamConversationProps['t']`（`slots.ts` 里它与 `TeamSidebarProps['t']`
 * 就是同一个形状，那个文件自己写明了「不另立一个」）。
 *
 * ⚠ 为什么 `t` 必须是这个**宽**签名（`key: string`）而不是索菲亚面板的 `Translate`
 * （`key: LocaleKey`）：本页要调用宿主字典里**没有**的那 21 个键，窄签名会在
 * `tsc` 阶段直接拒掉它们（那正是「键不存在」这个事实的正确表达，但本页的处置是
 * 「宿主缺就兜底」，见文件头）。
 */
export type HumanSettingsSectionProps = {
  readonly t: TeamConversationProps['t']
} & HumanSettingsSectionInjected

/**
 * 页内兜底字典 —— 21 条 `humanSettings*` 文案。
 *
 * ⚠ **值逐字照抄上游 `locales.ts`（114–135 行）的简体中文**，不是本文件自撰；
 * 键名也与上游逐字一致。存在的理由与移交条件见文件头「文案」那一节。
 */
const HUMAN_SETTINGS_COPY: Readonly<Record<string, string>> = {
  humanSettingsNav: '我的资料',
  humanSettingsTitle: '我的资料',
  humanSettingsIntro: '这是 Agent Team 的资料页：名字用在 Team 的消息与成员列表里，头像出现在你发出的消息旁。',
  humanSettingsName: '名字',
  humanSettingsNameHint: 'Agents 用这个名字 @ 到你；改名只对之后的消息生效。',
  humanSettingsNameEmpty: '名字不能为空。',
  humanSettingsNameFailed: '名字没保存上：{message}',
  humanSettingsAvatar: '头像',
  humanSettingsAvatarHint: '只收图片，最大 10MB；移除或损坏时回退为默认头像。',
  humanSettingsSave: '保存',
  humanSettingsSaving: '正在保存…',
  humanSettingsUpload: '上传头像',
  humanSettingsUploading: '正在上传…',
  humanSettingsReplace: '更换头像',
  humanSettingsRemoveAvatar: '移除头像',
  humanSettingsAvatarNotImage: '只收图片文件。',
  humanSettingsAvatarTooLarge: '图片不能超过 10MB。',
  humanSettingsAvatarFailed: '头像没能保存：{message}',
  humanSettingsLoading: '正在载入资料…',
  humanSettingsUnavailable: '资料读不出来：{message}',
  humanSettingsVersion: '版本 {version}',
  humanSettingsUpdateAvailable: '有新版本 {version}，去查看发布说明',
}

/**
 * 把宿主字典包成「宿主优先、本页兜底」的那一个 `t`。
 *
 * 插值语法与索菲亚既有字典一致（`{name}` 形态，认不得的占位符原样保留 ——
 * 不静默抹掉，否则界面上会出现「名字没保存上：」这种看不出哪里错的文本；
 * 同一条纪律见 `../bridge.ts` 的 `t`）。
 *
 * ⚠ 判「宿主有没有这条键」用的是 `typeof … !== 'string' || === ''`：
 * 索菲亚的 `bridge.ts` 对缺键返回 `undefined`（它的字典是 `zh[key]` 查表），
 * 而它的声明类型是 `string` ⇒ 只能运行期判类型，不能靠类型。
 */
function settingsText(hostT: TeamConversationProps['t']): TeamConversationProps['t'] {
  return (key, params) => {
    const hosted = hostT(key, params)
    if (typeof hosted === 'string' && hosted !== '') return hosted
    const template = HUMAN_SETTINGS_COPY[key]
    if (template === undefined) return hosted
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = params[name]
      return value === undefined ? whole : String(value)
    })
  }
}

/**
 * 上游 `./avatar-image.ts` 的 `useAvatarImage` 等价物（**内联**，理由见文件头）。
 *
 * ⚠ 失败标记**按 URL 记忆**（不是永久布尔）：索菲亚同目录已经修过两次这条
 * （`TeamMemberAvatarImage.tsx` / `TeamMessage.tsx` 的注释都记了它），
 * 而 `tests/client-sources.spec.ts` 的「头像失败状态按 URL 记忆」那条断言
 * （`failedUrl === url`，且不得写成 `useState(false)`）适用的正就是这类实现 ——
 * 移植时照同一条判据做，否则会把那个已修的缺陷重新引进 `vendor/`。
 */
function useAvatarImage(url: string | undefined): { readonly src: string | undefined; readonly failed: () => void } {
  const { useState } = hooks()
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = (): void => { if (url !== undefined) setFailedUrl(url) }
  return {
    src: url === undefined || url === '' || failedUrl === url ? undefined : url,
    failed,
  }
}

/**
 * `primitives.Input` 在本页需要的属性集 —— 上游用的是宿主原语，
 * 索菲亚的共享类型桩少声明了 `aria-label` / `aria-invalid`（见文件头）。
 * 这是**本页局部**的放宽，不修改 `vendor/upstream-modules.d.ts`。
 */
interface SophiaInputProps {
  readonly value?: string | undefined
  readonly onChange?: ((event: { readonly target: { readonly value: string } }) => void) | undefined
  readonly disabled?: boolean | undefined
  readonly autoFocus?: boolean | undefined
  readonly placeholder?: string | undefined
  readonly className?: string | undefined
  readonly 'aria-label'?: string | undefined
  readonly 'aria-invalid'?: boolean | undefined
}

/**
 * Run one durable write and reduce every failure to the message the page
 * reports. A rejected Remote call (a dropped carrier, a refused write) is a
 * failure like any other: without this the field would sit on "saving" forever
 * and report nothing.
 */
async function failureOf(action: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return await action()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** First visible character of a display name, or the neutral `H` before one is known. */
function avatarInitial(name: string | undefined): string {
  const trimmed = (name ?? '').replace(/^@/, '').trim()
  return trimmed === '' ? 'H' : trimmed.slice(0, 1).toUpperCase()
}

export function HumanSettingsSection(props: HumanSettingsSectionProps) {
  const { useRef, useState } = hooks()
  const { Button } = primitives
  // ⚠ 索菲亚移植点（见文件头）：共享类型桩的 `Input` 少了两个 aria 属性，
  // 这里只在本页放宽。桩补上后，本行可换成 `const { Input } = primitives`。
  const Input = primitives.Input as unknown as (props: SophiaInputProps) => ReactElement | null
  // ⚠ 上游这里是 `const { t, identity } = props`：`t` 直取宿主字典。
  // 索菲亚的字典缺那 21 个 humanSettings 键 ⇒ 这里包一层「宿主优先、本页兜底」，
  // 调用点因此逐字保留（理由与移交条件见文件头「文案」）。
  const t = settingsText(props.t)
  const { identity } = props
  const profile = useHumanIdentity(identity)
  // Undefined means "follow the Host value": the field re-syncs whenever the
  // profile changes underneath, without a background read clobbering a name
  // the reader is still editing.
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const filePicker = useRef<HTMLInputElement | null>(null)

  const name = draft ?? profile.name ?? ''
  const dirty = draft !== undefined && draft.trim() !== (profile.name ?? '')
  const emptyName = draft !== undefined && draft.trim() === ''
  const hasAvatar = profile.avatarRef !== undefined
  // The circle answers to decoded bytes, not to a stored reference: the Host
  // accepts any `image/…` payload, so a file this browser cannot read has to
  // fall back to the initial exactly as a removed one does.
  const avatar = useAvatarImage(profile.avatarUrl)

  const submitName = async (): Promise<void> => {
    if (!dirty || emptyName || saving) return
    setSaving(true)
    setNotice(null)
    const failure = await failureOf(() => props.saveName(name.trim()))
    setSaving(false)
    if (failure !== undefined) {
      setNotice(t('humanSettingsNameFailed', { message: failure }))
      return
    }
    setDraft(undefined)
  }

  const pickAvatar = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    setNotice(null)
    if (!file.type.startsWith('image/')) {
      setNotice(t('humanSettingsAvatarNotImage'))
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setNotice(t('humanSettingsAvatarTooLarge'))
      return
    }
    setUploading(true)
    const failure = await failureOf(() => props.uploadAvatar(file))
    setUploading(false)
    if (failure !== undefined) setNotice(t('humanSettingsAvatarFailed', { message: failure }))
  }

  const removeAvatar = async (): Promise<void> => {
    setNotice(null)
    const failure = await failureOf(() => props.removeAvatar())
    if (failure !== undefined) setNotice(t('humanSettingsAvatarFailed', { message: failure }))
  }

  // The page says what it is before it says what happened: the settings nav
  // lists it beside the Harness's own pages, so the title alone leaves "whose
  // profile is this, and where does it apply?" unanswered — and every state,
  // including a failed read, has to answer it.
  const pageHeader = <>
    <h2 className={css.heading}>{t('humanSettingsTitle')}</h2>
    <p className={css.intro}>{t('humanSettingsIntro')}</p>
  </>

  if (profile.status === 'loading' && profile.name === undefined) {
    return <div className={css.section}>
      {pageHeader}
      <p className={css.state} role="status">{t('humanSettingsLoading')}</p>
    </div>
  }

  if (profile.name === undefined) {
    return <div className={css.section}>
      {pageHeader}
      <p className={css.state} role="alert">{t('humanSettingsUnavailable', { message: profile.error ?? '' })}</p>
      <div className={css.stateAction}>
        <Button variant="outline" onClick={() => { void identity.refresh() }}>{t('retry')}</Button>
      </div>
    </div>
  }

  return (
    <div className={css.section}>
      {pageHeader}
      <div className={css.rows}>
        <div className={css.row}>
          <div className={css.rowText}>
            <div className={css.title}>{t('humanSettingsName')}</div>
            <div className={css.desc}>{t('humanSettingsNameHint')}</div>
          </div>
          <form
            className={css.controls}
            onSubmit={(event) => {
              event.preventDefault()
              void submitName()
            }}
          >
            <Input
              className={css.nameInput!}
              aria-label={t('humanSettingsName')}
              aria-invalid={emptyName || undefined}
              value={name}
              disabled={saving}
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <Button type="submit" variant="primary" disabled={saving || !dirty || emptyName}>
              {saving ? t('humanSettingsSaving') : t('humanSettingsSave')}
            </Button>
          </form>
        </div>
        <div className={css.row}>
          <div className={css.rowText}>
            <div className={css.title}>{t('humanSettingsAvatar')}</div>
            <div className={css.desc}>{t('humanSettingsAvatarHint')}</div>
          </div>
          <div className={css.controls}>
            {avatar.src === undefined
              ? <span className={`${css.identity} ${css.identityFallback}`} data-avatar="initial" aria-hidden="true">{avatarInitial(profile.name)}</span>
              : <img className={`${css.identity} ${css.identityImage}`} data-avatar="image" src={avatar.src} alt="" onError={avatar.failed} />}
            <input
              ref={filePicker}
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              hidden
              onChange={(event) => {
                void pickAvatar(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <Button
              variant="outline"
              disabled={uploading}
              onClick={() => { filePicker.current?.click() }}
            >
              {uploading ? t('humanSettingsUploading') : hasAvatar ? t('humanSettingsReplace') : t('humanSettingsUpload')}
            </Button>
            {hasAvatar && <Button disabled={uploading} onClick={() => { void removeAvatar() }}>{t('humanSettingsRemoveAvatar')}</Button>}
          </div>
        </div>
      </div>
      <div className={css.footnote}>
        <span>{t('humanSettingsVersion', { version: profile.version ?? '' })}</span>
        <span aria-hidden="true">·</span>
        <a className={css.link} href={profile.repoUrl ?? ''} target="_blank" rel="noreferrer">GitHub</a>
        {profile.updateAvailable && profile.latestVersion !== undefined
          ? <a
              className={css.link}
              href={`${profile.repoUrl ?? ''}/releases`}
              target="_blank"
              rel="noreferrer"
            >{t('humanSettingsUpdateAvailable', { version: profile.latestVersion })}</a>
          : null}
      </div>
      {emptyName && <p className={css.notice}>{t('humanSettingsNameEmpty')}</p>}
      {notice === null ? null : <p className={css.notice} role="alert">{notice}</p>}
    </div>
  )
}
