/**
 * 左栏「Agents」分组（上游 `TeamAgentsPanel.tsx` 的索菲亚版）。
 *
 * ## 照抄了什么、没照抄什么（一句话）
 *
 * **渲染结构与外观逐字照抄**（`sidebar.module.css` + `create.module.css` 是
 * 同一个字节级副本，`.agentRow` / `.agentSelect` / `.agentAvatar\*` /
 * `.agentCopy` / `.rowMenu` 全部逐字生效）；**只改数据来源**与
 * **索菲亚宿主没有的那几个写操作**。
 *
 * ## 与上游的差异逐条（每条都是「索菲亚没有那个事实」，**不静默删**）
 *
 * | 上游 | 索菲亚 | 原因 |
 * |---|---|---|
 * | `workspaceId: WorkspaceId`（宿主包） | `./ids.ts` 的 `WorkspaceId` | 索菲亚没有那个包 |
 * | `loadMembers` 返回带 `sessionId` / `availability` / `workspaceIds` / `model` / `capabilities` 的状态 | 索菲亚的状态只有 `member{memberId,handle,description,state,avatarPath?}` + `presence` | 见 `agent-team-types.ts` 的 `AgentTeamClientMemberStatus` 逐条说明 |
 * | `addMember(request)` 带回 `{status, workspaceIds}` | 只回 `ok` | 索菲亚路由 `POST /api/sophia/member` 的响应是 `{ok:true}`（`host.ts` 的 `memberRoute`）⇒ 建成功后**重读名册**，不再乐观插入一条本地合成的行 |
 * | 创建表单的「说明」字段 | 保留控件、**如实说明它不发给宿主** | `/api/sophia/member` 只接受 `{teamId, position}`，没有描述字段 |
 * | 创建表单的模型选择器（`ModelPickerField`） | 保留字段位置、**如实说明索菲亚没有模型目录** | 索菲亚 client 半没接宿主模型目录服务；`bridge.ts` 的 `createEmptyModelDirectory()` 是既有的空目录桩 |
 * | 「导入 Agent」（`TeamAgentImport`）模式切换 | **剥掉** | 上游靠 `joinWorkspace`（把成员加进另一个工作区）。索菲亚**没有**这条路由：成员加入要**建团审批**（`spawn/*`），不是侧栏能点出来的动作 |
 * | 行菜单：`edit` / `restart` / `archive` / `withdraw` | 收敛成 `resume`（恢复）/ `suspend`（停用） | 索菲亚只有一条 `POST /api/sophia/member/lifecycle`（`action ∈ suspend|resume`）。`edit` 需要「改成员」路由（没有）；`restart` 与 `resume` 在索菲亚是同一条；`archive` 是墓碑（不可逆），与可逆的 `suspend` 不是同一件事，做成一个按钮会让「归档」这个名字承诺一件做不到的事 |
 * | `followRollover`（观察成员会话绑定迁移并跟随） | **剥掉** | 索菲亚线格式**不含**成员会话 id（`AgentTeamClientMember.sessionId` 恒 `undefined`）⇒ 没有可观察的绑定 |
 * | `memberSessionId` + `openMemberSession`（点行打开成员会话） | **剥掉** | 索菲亚没有「把成员会话嵌进会话座」这条路 ⇒ 行按钮改成**不可点**（`disabled`），保留 `aria-current` 的选中语义供将来接上 |
 * | `presence` 作用域的第二条订阅 | **合并成一条** | 索菲亚的 `subscribeChanges` **忽略 scope**（`slots.ts` 的 `SubscribeTeamChanges`）⇒ 两条订阅会在每次变化时各刷一次名册，那是同一个事实的两次读。上游两条作用域是**互斥**的，索菲亚没有这一维 |
 *
 * ## 保留了的上游细节
 *
 * - `TeamSidebarSection` + `+` 按钮 + `Modal` 创建表单（名称/说明/模型三个字段位）；
 * - 行几何、圆形头像（`TeamMemberIdentity` → 索菲亚的 `.sp-avatar` 素材）、
 *   悬停才出现的行尾省略号（`TeamRowMenu`）；
 * - 「首次加载才占加载面」「空态要已加载 + 无错误」「失败行带重试键」三条既有纪律；
 * - 拖拽排序整条链。
 *
 * @module @sophia/core/client/vendor/team/TeamAgentsPanel
 */

import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { AgentTeamClientMemberStatus } from './agent-team-types.ts'
import type { WireMember } from '../../../wire.ts'
import type { WorkspaceId } from './ids.ts'
import type { TeamSidebarProps } from './slots.ts'
import { TeamMemberIdentity } from './TeamMemberRow.tsx'
import { SortableRow, useSidebarRowDrag } from './sidebar-drag.tsx'
import { moveSidebarItem, useSidebarOrder } from './sidebar-order.ts'
import { useSidebarSectionOpen, setSidebarSectionOpen } from './sidebar-sections.ts'
import { TeamRowMenu } from './TeamRowMenu.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import createCss from './create.module.css'
import css from './sidebar.module.css'

interface TeamAgentsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly subscribeChanges: TeamSidebarProps['subscribeChanges']
  readonly addMember: TeamSidebarProps['addMember']
  readonly setMemberLifecycle: TeamSidebarProps['setMemberLifecycle']
  /**
   * 「换模」（索菲亚独有，2026-09-24 从旧团队卡搬进左栏）。可选：
   * 缺省 ⇒ 行菜单不画这一项（「回调缺省 ⇒ 不画入口」）。
   */
  readonly switchModel?: ((member: WireMember) => void) | undefined
  readonly t: TeamSidebarProps['t']
}

export function TeamAgentsPanel({ workspaceId, loadMembers, subscribeChanges, addMember, setMemberLifecycle, switchModel, t }: TeamAgentsPanelProps) {
  const { useCallback, useEffect, useMemo, useRef, useState } = hooks()
  const { Button, IconPlusOutline16, Input, Modal, Tooltip } = primitives
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [handle, setHandle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Same presentation-preference ordering as the Channels list; the drag
  // commits through one shared mutation.
  const agentRefs = useMemo(() => members.map(status => status.member.memberId), [members])
  const orderedAgentRefs = useSidebarOrder(workspaceId, 'agents', agentRefs)
  const orderedMembers = useMemo(() => {
    const byId = new Map(members.map(status => [status.member.memberId, status]))
    return orderedAgentRefs.map(memberId => byId.get(memberId)).filter(status => status !== undefined)
  }, [orderedAgentRefs, members])
  const applyMove = (movedRef: string, targetRef: string, marker: 'before' | 'after'): void => {
    void moveSidebarItem(workspaceId, 'agents', orderedAgentRefs, movedRef, targetRef, marker)
  }
  const drag = useSidebarRowDrag({ refs: orderedAgentRefs, onCommit: applyMove })
  const sectionOpen = useSidebarSectionOpen(workspaceId, 'agents')

  // Only the first refresh owns the loading surface; presence wakes (Agent
  // running/idle) refresh rows in place.
  //
  // ⚠ 索菲亚移植点：上游这里有**两条**订阅（`{kind:'workspace'}` 与
  // `{kind:'presence'}`）。索菲亚的 `subscribeChanges` 忽略 scope
  // （见 `slots.ts` 的 `SubscribeTeamChanges`）⇒ 两条会在每次变化时各刷一次名册。
  // 一条订阅拿到的是同一份事实，故合并（这是「去掉一次重复读」，不是去掉一个事实）。
  const loadedRef = useRef(false)
  const refresh = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    const result = await loadMembers({ workspaceId })
    if (result.ok) {
      // Archived Members are hidden from every surface; the row disappears
      // the moment the workspace-scope wake delivers the archived state.
      //
      // ⚠ 索菲亚移植点（**这一行曾经是错的，别改回去**）：上游这里把 `'inactive'`
      // **也一起**滤掉 —— 上游的 `'inactive'` 与索菲亚的「已挂起」不是同一个事实。
      // 索菲亚的适配层把 `lifecycle: 'suspended'` 映射成 `'inactive'`
      // （`adapters.ts` 的 `memberStateOf`）⇒ 「一起滤掉」会让**停用变成单向门**：
      // 点完「停用」那一行当场消失，下面 `AgentRow` 里的 `suspended` 恒为 false
      // ⇒ 菜单里的「恢复」**永远渲染不出来**，而全仓 `setMemberLifecycle` 只剩
      // 这一个消费点（`TeamMembersAction` 的名册是只读的，不给 `action`）
      // ⇒ **界面上再也恢复不了**。这是独立评审抓到的 high。
      // ⇒ 现在只滤**真墓碑**（`'archived'` / `'destroyed'` 的映射结果）；
      //    `rosterOf` 已经按 `tombstone` 滤过一层，这里是第二道、也是最后一道。
      const next = result.value.filter(status => status.member.state !== 'archived')
      setMembers(next)
      setError(undefined)
      loadedRef.current = true
    } else {
      setError(result.error.message)
    }
    setLoading(false)
  }, [loadMembers, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeChanges({ kind: 'workspace', workspaceId }, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    // The section stays mounted across Channel creation, so the Member roster
    // rides every workspace invalidation.
    void refresh()
  }), [subscribeChanges, refresh, workspaceId])

  const closeForm = () => {
    if (creating) return
    setFormOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedHandle = handle.trim()
    if (normalizedHandle.length === 0 || creating) return
    setCreating(true)
    setError(undefined)
    try {
      const result = await addMember({ workspaceId, position: normalizedHandle })
      if (result.ok) {
        setHandle('')
        setDescription('')
        setFormOpen(false)
        // ⚠ 索菲亚移植点：上游在这里用 `result.value.status` **乐观插入**一行
        // （并据它的 presence 决定是否报诊断）。索菲亚的路由只回 `{ok:true}`、
        // 不回成员状态 ⇒ 老实**重读一次名册**，而不是本地合成一条可能不存在的行。
        await refresh()
        queueMicrotask(() => { triggerRef.current?.focus() })
      } else {
        await refresh()
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={css.panel}>
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={t('addAgent')}
        closeLabel={t('close')}
        contentClassName={createCss.dialogContent!}
        footer={<><Button variant="outline" disabled={creating} onClick={closeForm}>{t('cancel')}</Button><Button type="submit" form="team-agent-create-form" variant="primary" disabled={creating || handle.trim().length === 0}>{creating ? t('creatingAgent') : t('createAgent')}</Button></>}
      >
        <form id="team-agent-create-form" className={createCss.form} onSubmit={event => { void submit(event) }}>
          <label className={createCss.field}>
            <span>{t('agentName')}</span>
            <Input className={createCss.input!} value={handle} onChange={event => { setHandle(event.target.value) }} disabled={creating} autoFocus />
          </label>
          {/* ⚠ 索菲亚移植点（独立评审抓到的 medium，**这行提示是必须的**）：
              上游这个框收的是 `handle`（自由文本的成员名，索菲亚也确实拿它当 `handle`
              与显示名）。但索菲亚的 `POST /api/sophia/member` 收的是 `{teamId, position}`，
              而 `position` 在宿主是**闭集**（`src/naming.ts` 的 `POSITIONS`，
              `validatePosition()` 对名册外一律硬拒绝；`host-data.ts` 的加成员先跑它）。
              ⇒ 随便填「小明」**必然失败**；而初版界面上既没有候选也没有提示，
              用户只能靠自己撞一次错误才发现（相邻那两个不可用字段都有提示，这里反而没有）。
              **为什么不做成下拉**：合法职位名只有宿主知道（`POSITIONS` 在 host 半，
              client 半没有这个包），在界面上手抄一份候选表就是**第二个真相** ——
              素材目录/名册一改两边就分叉。所以这里**不猜候选**，而是把规则说清楚：
              填错时宿主的回执**会列出全部合法职位名**（`naming.ts:16` 的硬要求），
              那个原文由下面 `createCss.error` 的 `role="alert"` 原样显示，不吞。 */}
          <p className={css.editHint}>{t('sidebarPositionHint')}</p>
          {/* ⚠ 索菲亚移植点：这个字段**保留但禁用**，并如实说明原因。
              索菲亚的 `POST /api/sophia/member` 只接受 `{teamId, position}`
              （`panel-store.ts:553` 的 `requestAddMember`），**没有描述字段** ——
              留一个能输入却永远发不出去的框，就是在承诺一件做不到的事。
              处置手法与 `bridge.ts` 的 `TEAM_HALT_AVAILABLE` 同源：
              控件保留（删了就没人知道为什么没有），但把「不可用」明说出来。 */}
          <label className={createCss.field}>
            <span>{t('agentDescription')}{t('optionalSuffix')}</span>
            <Input className={createCss.input!} value={description} placeholder={t('agentDescriptionPlaceholder')} onChange={event => { setDescription(event.target.value) }} disabled />
          </label>
          <p className={css.editHint}>{t('sidebarAddAgentDescriptionUnsupported')}</p>
          {/* ⚠ 索菲亚移植点：上游这里是 `<ModelPickerField …/>`（读宿主模型目录）。
              索菲亚的 client 半**没有**接模型目录服务（`bridge.ts` 的
              `createEmptyModelDirectory()` 就是那条处置），成员模型跟随全局默认
              ⇒ 保留**字段位**与标签，内容如实说明，而不是画一个永远空的下拉。 */}
          <div className={createCss.field}>
            <span>{t('memberModel')}</span>
            <p className={css.editHint}>{t('sidebarModelCatalogUnavailable')}</p>
          </div>
          {error !== undefined && <p className={createCss.error} role="alert">{error}</p>}
        </form>
      </Modal>
      <TeamSidebarSection
        title={t('agents')}
        open={sectionOpen}
        onToggle={open => { setSidebarSectionOpen(workspaceId, 'agents', open) }}
        actions={(
          <Tooltip label={t('addAgent')} delayMs={500}>
            <button ref={triggerRef} type="button" className={css.iconButton} aria-label={t('addAgent')} onClick={() => { setError(undefined); setFormOpen(true) }}>
              <IconPlusOutline16 size={14} />
            </button>
          </Tooltip>
        )}
      >
        {loading && members.length === 0 && <p className={css.emptyState}>{t('loadingAgents')}</p>}
        {/* `members` is empty both before the first successful load and after a
            failed one, so the empty claim additionally requires a clear error. */}
        {!loading && error === undefined && members.length === 0 && <p className={css.emptyState}>{t('emptyAgents')}</p>}
        <div className={css.agentList}>
          {orderedMembers.map(status => (
            <SortableRow key={status.member.memberId} drag={drag} orderKey={status.member.memberId}>
              <AgentRow status={status} setMemberLifecycle={setMemberLifecycle} switchModel={switchModel} onUpdated={refresh} t={t} />
            </SortableRow>
          ))}
        </div>
      </TeamSidebarSection>
      {!formOpen && error !== undefined && (
        <div className={css.retryError} role="alert">
          <span>{error}</span>
          <button type="button" className={css.textButton} disabled={creating} onClick={() => { setFormOpen(true) }}>{t('retry')}</button>
        </div>
      )}
    </div>
  )
}

/**
 * One sidebar Agent row: the avatar carries identity, and the row menu opens
 * the lifecycle actions.
 *
 * ⚠ 索菲亚移植点（见文件头的表）：行的选择按钮在索菲亚**不可点** ——
 * 上游点它会把成员会话嵌进会话座（`openMemberSession`），索菲亚没有那条路。
 * 按钮本身、`aria-label`、`aria-current`、`data-agent-row`、头像与两行文案
 * 全部保留：结构在，能力不在，且**不假装在**。
 */
function AgentRow({ status, setMemberLifecycle, switchModel, onUpdated, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly setMemberLifecycle: TeamSidebarProps['setMemberLifecycle']
  /**
   * 「换模」（索菲亚独有）。可选：缺省 ⇒ 菜单不画；成员没有可提交目标
   * （`sophiaMember` 缺席 = 墓碑 / 跟随全局默认）⇒ 同样不画 ——
   * 与 `MemberCard`（components.tsx）的两层防线同一句话：
   * 界面不展示一个做不到的操作。交回**整个 WireMember**
   * （seats.tsx 要读 member.model 当提交目标）。
   */
  readonly switchModel?: ((member: WireMember) => void) | undefined
  readonly onUpdated: () => Promise<void> | void
  readonly t: TeamSidebarProps['t']
}) {
  const { useState } = hooks()
  const { IconPlayOutline16, IconStopFill16 } = primitives
  const [menuOpen, setMenuOpen] = useState(false)
  const [rowAlert, setRowAlert] = useState<string>()
  const [lifecyclePending, setLifecyclePending] = useState(false)
  // 索菲亚只有可逆的挂起/恢复；`state` 由适配层从 `lifecycle` 映射而来
  // （见 `adapters.ts` 的 `memberStateOf`）。`inactive` = 已挂起 ⇒ 可以恢复。
  const suspended = status.member.state === 'inactive'
  const change = async (action: 'suspend' | 'resume'): Promise<void> => {
    if (lifecyclePending) return
    setLifecyclePending(true)
    setRowAlert(undefined)
    try {
      const result = await setMemberLifecycle({ memberId: status.member.memberId, action })
      if (!result.ok) throw new Error(result.error.message)
      await onUpdated()
    } catch (cause) {
      setRowAlert(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLifecyclePending(false)
    }
  }
  return (
    <>
      <div className={css.agentRow} data-agent-row data-menu-open={menuOpen || undefined}>
        <button type="button" className={css.agentSelect} aria-label={t('openAgentSession', { name: status.member.handle })} disabled onClick={() => { /* 见函数头：索菲亚没有「打开成员会话」这条路 */ }}>
          <TeamMemberIdentity status={status} name={status.member.handle.replace(/^@/, '')} className={css.agentCopy} />
        </button>
        <span className={css.rowMenu}>
          <TeamRowMenu
            label={t('actionsAgent', { name: status.member.handle })}
            items={[
              ...(suspended
                ? [{ id: 'resume', label: t('resumeAgent'), icon: <IconPlayOutline16 /> }]
                : [{ id: 'suspend', label: t('suspendAgent'), icon: <IconStopFill16 size={16} /> }]),
              // 「换模」（索菲亚独有，2026-09-24 搬进左栏）：仅在"回调给了 且
              // 成员有可提交目标"时出现。`title` 用 zh/en 字典里那条说明。
              ...(switchModel !== undefined && status.sophiaMember !== undefined
                ? [{ id: 'switch-model', label: t('switchModel') }]
                : []),
            ]}
            onSelect={(id) => {
              if (id === 'switch-model') {
                // `sophiaMember` 在 ⇒ 回调必在（条目与它同条件渲染）。
                // 交**整个 WireMember**：与 `seats.tsx` 的 `onSwitchModel` 原生签名
                // 一致（它要读 member.model 当提交目标），不在中间层折断语义。
                if (status.sophiaMember !== undefined && switchModel !== undefined) {
                  switchModel(status.sophiaMember)
                }
                return
              }
              void change(id === 'resume' ? 'resume' : 'suspend')
            }}
            onOpenChange={setMenuOpen}
          />
        </span>
      </div>
      {rowAlert !== undefined && <div className={css.rowAlert} role="alert">{rowAlert}</div>}
      {/* ⚠ 上游这里还有一个归档/撤回的确认 Modal + 成员编辑对话框
          （`AgentEditorDialog`）。两者都依赖索菲亚没有的写路由
          （改成员 / 归档成员 / 退出工作区）⇒ 见文件头的表，一并剥掉。
          挂起/恢复不需要确认框：可逆，且失败会落在上面的 rowAlert 行里。 */}
    </>
  )
}
