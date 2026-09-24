/**
 * 上游 `TeamMemberEditor.tsx`（14.2KB / 305 行）的索菲亚版 —— **成员编辑对话框**。
 *
 * ## 与上游的关系（先读这一段）
 *
 * 上游这个文件是**两块**拼起来的：
 *
 * ① `ModelPickerField` + 它背后那条共享目录缓存链
 *    （`modelKey` / `ModelCatalogCache` / `modelCatalogCaches` / `peekCatalogGroups` /
 *    `sharedCatalog` / `warmModelCatalog`，上游 12–225 行）；
 * ② `AgentEditorDialog`（改 handle / 描述 / 模型，经**一次**持久更新提交，上游 227–299 行）。
 *
 * 索菲亚版**照抄 ②**（Modal / form / 两个 `Input` / 字段位 / `aria-*` / dirty 判定 /
 * 保存生命周期接线逐字保留），**剥掉 ①**。
 *
 * ## ⚠ 剥掉 ① 是**结构性的**，不是「一时没接」（四条依据，可逐条核）
 *
 * | 依据 | 内容 |
 * |---|---|
 * | `slots.ts:585` | owner 的剥除清单原文：`loadModels` —— 索菲亚 client 半没接宿主模型目录服务；上游的创建/编辑表单靠它填下拉框 ⇒ **索菲亚的表单不带模型选择器** |
 * | `TeamAgentsPanel.tsx:19`、`:180-190` | 同目录既有文件对**同一个** `ModelPickerField` 的处置：保留字段位 + `t('sidebarModelCatalogUnavailable')` 如实说明 |
 * | `vendor/upstream-modules.d.ts` 的 `Input` 声明 | 它的注释**点名**本文件，且只列了 `agentName` / `agentDescription` 两处用到的六个 prop（`value` / `onChange` / `disabled` / `autoFocus` / `placeholder` / `className`）—— 没有 `Menu` 的任何痕迹 |
 * | `scripts/seed-ui-primitives-stub.mjs:54` | 测试替身清单里 `Input` 一行的注释同样点名 `TeamMemberEditor` |
 *
 * 若照抄 ①，`loadModels` 在索菲亚**恒不传** ⇒ 那个下拉永远停在
 * 「正在加载模型目录…」或「模型目录加载失败」，等于在界面上装一个**不可能成功的控件**。
 *
 * ## 剥掉的东西（逐项 + 上游行号 + 理由；**不静默删**）
 *
 * | 剥掉的上游功能 | 上游行号 | 理由（每条都是「索菲亚没有那个事实」） |
 * |---|---|---|
 * | `ModelPickerField`（provider/model 下拉 + effort 子行） | 69–225 | 数据全来自 `loadModels`（见上表第一行） |
 * | 共享目录缓存链（`modelKey` / `ModelCatalogCache` / `modelCatalogCaches` / `peekCatalogGroups` / `sharedCatalog` / `warmModelCatalog`） | 12–67 | 只服务上面那个下拉（`WeakMap` 的 key 就是 `loadModels` 函数本身），没有第二个消费者 |
 * | 模型字段（`useState<AgentTeamModelSelection \| undefined>(status.member.model)`、payload 的 `model`、`sameModel`） | 243、249–250、260、267、294、301–305 | `AgentTeamModelSelection` 与 `TeamModelCatalog` / `TeamModelProviderGroup` / `TeamModelEffortOption` 在索菲亚的 `agent-team-types.ts` / `slots.ts` 里**都不存在**（已逐名 grep 核对）；索菲亚成员身份也只有 `memberId` / `handle` / `description` / `state` / `sessionId?` / `avatarPath?`，**没有** `model` |
 * | `capabilities` 回显 | 261–263 | 同上：索菲亚成员身份没有 `capabilities` 字段。上游那一句的用途是「编辑器不拥有该字段，但缺省会被宿主当成清空 ⇒ 原样回显」，没有字段就没有可回显的意图 |
 * | `mintRequestId()` 与请求体的 `requestId` | 269 | 索菲亚**没有** `./requests.ts` 的 `mintRequestId`（该导出已剥掉）⇒ 请求体不含 `requestId` |
 * | `import { mintRequestId } from './requests.ts'` | 7 | 同上 |
 * | `loadModels` prop | 82、235 | 见上表第一行 |
 *
 * ## ⚠ 一处**语义变化**（不是等价照抄，必须说清）
 *
 * 上游把刚提交过的请求对象留在 `pendingRequest` 里、下次提交时若内容同一就**复用同一个对象**
 * （`samePending` 分支）。它成立的前提是请求体带 `requestId` —— 宿主按幂等键去重，
 * 于是「复用」等价于「不产生第二次写」。
 *
 * 索菲亚没有幂等键（见上表）⇒ 本文件**保留** `pendingRequest` 的读写（结构照抄：
 * 编辑任一字段就清空它），但复用一个请求对象**不再提供宿主侧去重**。
 * 它今天的作用只有一个：`useEditDialogSave` 用它判断「当前在途的是不是正在编辑的这一份」。
 * 宿主补上幂等键后，把 `requestId` 加回 payload 即可恢复上游语义。
 *
 * ## 索菲亚移植点（类型与取用方式，逻辑一行未改）
 *
 * | 上游 | 索菲亚 | 理由 |
 * |---|---|---|
 * | `import { useEffect, useState } from 'react'` | `import { hooks }` + 函数体内 `hooks()` | 顶层值导入会多一条顶层模块加载调用，撞红 `tests/client-sources.spec.ts` 的「产物里顶层加载调用 ≤ 2」那条**文本级**断言（见 `../../react-runtime.ts` 文件头对照表）。⚠ 本行刻意**不写出那个字面量**（加载函数名 + 左括号）：那条断言数的是 bundle 字符串，注释里写了也会被计入 |
 * | `import { Button, IconChevronDownOutline14, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'` | `import { primitives } from '../bridge.ts'` + 函数体内取 | 同上；`primitives` 是该代理的唯一通道。⚠ 其中 `IconChevronDownOutline14` / `Menu` / `MenuEntry` 只被①用 ⇒ 一并剥掉 |
 * | `import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'` | **剥掉** | 只被①用；且索菲亚的 client 源码不许 `from '@deepseek-ai/…'`（`tests/client-sources.spec.ts:179`，文本级断言） |
 * | `import type { AgentTeamClientMemberStatus, AgentTeamModelSelection, AgentTeamUpdateMemberRequest } from '@wowyuarm/dsh-agent-team/types'` | 只留 `AgentTeamClientMemberStatus`（`./agent-team-types.ts`），其余两个按用到的字段本地声明（见 `TeamMemberEditRequest`） | 索菲亚没有那个上游包；三个名字里只有第一个在 `agent-team-types.ts` 里真的导出（已 grep 核对导出表） |
 * | `import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'` | `TeamRemoteResult`（`./slots.ts`） | 索菲亚没有 typert 那个包；形状逐字相同（`{ok,value}` \| `{ok:false,error:{message}}`） |
 * | `TeamSidebarProps['loadModels']` / `['updateMember']` | 第一个**剥掉**（见上表）；第二个改成**显式最小函数签名**（见 `AgentEditorDialog` 的 prop 注释） | ⚠ `slots.ts` 的 `TeamSidebarProps` 里**没有**这两个成员：`loadModels` 与 `updateMember` 都在那个文件 570–600 行的「被剥掉的上游 props」清单里。`['t']` 那一项**存在**（同文件 506 行的 `TeamSidebarProps` 定义），故保留原样 |
 * | `React.FormEvent<HTMLFormElement>` | `import type { FormEvent } from 'react'` + `FormEvent<HTMLFormElement>` | 上游那个 `React` 命名空间没有顶层导入（靠 UMD 全局），索菲亚不保证有那个全局；纯类型导入会被擦除，不留模块加载调用（先例：`vendor/StagingPlanEditor.tsx` 顶部同款写法） |
 * | `import css from './create.module.css'` / `'./sidebar.module.css'` | 原样 | 两份 CSS 已在目标目录存在（字节级副本），直接引用 |
 *
 * ## 模型字段位的处置（**保留位置、如实说明**，不是删掉）
 *
 * 上游这里渲染 `<ModelPickerField … />`。索菲亚保留**同一个字段容器与标签**
 * （`createCss.field` + `t('memberModel')`），内容换成一行如实说明
 * （`t('sidebarModelCatalogUnavailable')`）—— 与 `TeamAgentsPanel.tsx:180-190` 逐字同源。
 * 删掉控件而不是说明它为什么不在，等于把原因一起藏起来（与 `bridge.ts` 的
 * `TEAM_HALT_AVAILABLE` 同一处置手法）。
 *
 * ## ⚠ 索菲亚当前**没有渲染调用点**（如实说明）
 *
 * 上游的编辑对话框由行菜单的 `edit` 项打开。索菲亚的行菜单只有「恢复 / 停用」两项
 * （`TeamAgentsPanel.tsx` 的 `AgentRow`：上游的 `edit` / `restart` / `archive` / `withdraw`
 * 收敛成了 `setMemberLifecycle`）⇒ **本文件今天不被任何地方渲染**，
 * `vendor/team/index.ts` 也没有 re-export 它。
 *
 * 接上它需要两步（都在本文件之外）：
 * ① 宿主补一条「改成员」路由 —— 今天 `POST /api/sophia/member/lifecycle` 只收
 *    `suspend` / `resume`，改不了 handle 与描述（`slots.ts:580` 已把这条记在剥除清单里）；
 * ② 接线方把该路由包成 `updateMember` 传进来，并在行菜单里放回一个 `edit` 项。
 * 在那之前，本文件的 `updateMember` 是一个**照着上游形状留出的洞**，不是能用的能力。
 *
 * @module @sophia/core/client/vendor/team/TeamMemberEditor
 */

import type { FormEvent } from 'react'
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { AgentTeamClientMemberStatus } from './agent-team-types.ts'
import type { TeamRemoteResult, TeamSidebarProps } from './slots.ts'
import { useEditDialogSave } from './team-dialog-save.ts'
import createCss from './create.module.css'
import css from './sidebar.module.css'

/**
 * 一次成员编辑的请求体。
 *
 * ⚠ 上游类型是 `AgentTeamUpdateMemberRequest`（`@wowyuarm/dsh-agent-team/types`），
 * 索菲亚的 `agent-team-types.ts` 里**没有**它 —— 那份镜像只收「界面真的会用到的」
 * 上游类型，先例见 `human-identity.ts` 对 `AgentTeamHumanProfileResult` 的同款处置。
 * 这里按**用到的字段**本地重新声明，字段名与上游逐字一致。
 *
 * 上游那份请求体里还有三项，索菲亚没有对应事实（见文件头的剥除表）：
 * `requestId`（没有幂等键）、`model`（成员身份没有模型字段）、
 * `capabilities`（成员身份没有该字段）。
 */
export interface TeamMemberEditRequest {
  readonly memberId: AgentTeamClientMemberStatus['member']['memberId']
  readonly handle: string
  readonly description: string
}

/**
 * Agent editor: handle, description, and per-Member model selection commit
 * through one durable update. Channel membership is managed from the Channel
 * side, not here.
 *
 * ⚠ 索菲亚移植点（见文件头表）：
 * - `loadModels` prop 剥掉、模型字段改成「字段位 + 如实说明」；
 * - `updateMember` 的**上游类型**（`TeamSidebarProps['updateMember']`）在索菲亚
 *   `slots.ts` 里不存在（它在 570–600 行的剥除清单里，收敛成了可逆的
 *   `setMemberLifecycle`）⇒ 按规约写成**显式最小函数签名**：形状取自上游
 *   （收一个请求、回一个 `RemoteResult`），请求体类型用本文件的
 *   `TeamMemberEditRequest`，返回值形状用 `TeamRemoteResult`。
 */
export function AgentEditorDialog({ status, updateMember, onCommitted, onClose, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly updateMember: (request: TeamMemberEditRequest) => Promise<TeamRemoteResult<unknown>>
  readonly onCommitted: () => Promise<void> | void
  readonly onClose: () => void
  readonly t: TeamSidebarProps['t']
}) {
  const { useState } = hooks()
  const { Button, Input, Modal } = primitives
  const memberId = status.member.memberId
  const [handle, setHandle] = useState(status.member.handle)
  const [description, setDescription] = useState(status.member.description)
  const { saving, error, pendingRequest, save } = useEditDialogSave({
    save: updateMember,
    onCommitted,
    onClose,
  })
  // 上游这里还有第三项 `!sameModel(model, status.member.model)`：索菲亚没有模型字段（见文件头）。
  const dirty = handle.trim() !== status.member.handle || description.trim() !== status.member.description
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedHandle = handle.trim()
    const normalizedDescription = description.trim()
    if (saving || !dirty || normalizedHandle.length === 0) return
    const payload = {
      memberId,
      handle: normalizedHandle,
      description: normalizedDescription,
    }
    // 上游这里还比 `model`（已剥）。索菲亚没有幂等键 ⇒ 复用请求对象不再提供宿主侧去重，
    // 只剩「在途的是不是这一份」这一个用途（见文件头的「一处语义变化」）。
    const samePending = pendingRequest.current !== undefined && pendingRequest.current.memberId === payload.memberId
      && pendingRequest.current.handle === payload.handle && pendingRequest.current.description === payload.description
    const request: TeamMemberEditRequest = samePending ? pendingRequest.current! : { ...payload }
    await save(request)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('editAgent')}
      description={`@${status.member.handle}`}
      closeLabel={t('close')}
      contentClassName={createCss.dialogContent!}
      footer={<><Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="team-agent-edit-form" variant="primary" disabled={saving || !dirty || handle.trim().length === 0}>{saving ? t('editSaving') : t('editSave')}</Button></>}
    >
      <form id="team-agent-edit-form" className={createCss.form} onSubmit={event => { void submit(event) }}>
        <label className={createCss.field}>
          <span>{t('agentName')}</span>
          <Input className={createCss.input!} value={handle} onChange={event => { setHandle(event.target.value); pendingRequest.current = undefined }} disabled={saving} autoFocus />
        </label>
        <label className={createCss.field}>
          <span>{t('agentDescription')}{t('optionalSuffix')}</span>
          <Input className={createCss.input!} value={description} placeholder={t('agentDescriptionPlaceholder')} onChange={event => { setDescription(event.target.value); pendingRequest.current = undefined }} disabled={saving} />
        </label>
        {/* ⚠ 索菲亚移植点：上游这里是 `<ModelPickerField …/>`（读宿主模型目录，
            并用一个跨组件的 `WeakMap` 缓存那份目录）。索菲亚的 client 半**没有**接
            模型目录服务（`bridge.ts` 的 `createEmptyModelDirectory()` 就是那条处置），
            成员模型跟随全局默认 ⇒ 保留**同一个字段容器与标签**，内容如实说明，
            而不是画一个永远空的下拉。与 `TeamAgentsPanel.tsx:180-190` 逐字同源。 */}
        <div className={createCss.field}>
          <span>{t('memberModel')}</span>
          <p className={css.editHint}>{t('sidebarModelCatalogUnavailable')}</p>
        </div>
        {error !== undefined && <p className={createCss.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
