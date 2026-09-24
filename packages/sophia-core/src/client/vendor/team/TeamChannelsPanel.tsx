/**
 * 左栏「频道」分组（上游 `TeamChannelsPanel.tsx` 的索菲亚版）。
 *
 * ## 照抄了什么、没照抄什么（一句话）
 *
 * **渲染结构与外观逐字照抄**（`sidebar.module.css` + `create.module.css` 是
 * 同一个字节级副本）；**只改数据来源**与**索菲亚宿主没有的那几个写操作**。
 *
 * ## 与上游的差异逐条（每条都是「索菲亚没有那个事实」，**不静默删**）
 *
 * | 上游 | 索菲亚 | 原因 |
 * |---|---|---|
 * | `workspaceId: WorkspaceId`（宿主包） | `./ids.ts` 的 `WorkspaceId` | 索菲亚没有 `@deepseek-ai/dsh-api-workspace-controller/client` |
 * | `loadChannels` → `AgentTeamView` | → `TeamChannelView` | 索菲亚的频道没有 `description` / `workspaceId` / 归档态（见 `agent-team-types.ts` 的 `AgentTeamChannel`） |
 * | `createChannel(request)` 带 `requestId` | 不带 | 索菲亚宿主没有幂等键面（`requests.ts` 有逐条说明） |
 * | 行菜单（`editChannel` / `archiveChannel`） | **剥掉** | 索菲亚**没有**改频道名 / 归档频道的路由；而且频道在索菲亚**没有归档态** |
 * | 频道编辑对话框（名字/说明 + 频道成员增删） | **剥掉** | 上一条 + 索菲亚**没有频道成员关系**（成员属团，不属频道） |
 * | `MultiMenuField` 里「正在创建的 Agent」一组 | **剥掉** | 上游那组来自 `creatingAgents`（`addMember` 的返回值带回新的成员状态）。索菲亚的 `/api/sophia/member` 只回 `{ok:true}`，没有可跟踪的中间态 ⇒ 建完成员后**重读一次名册**（见 `TeamAgentsPanel`） |
 *
 * ## 保留了的上游细节（容易被误当成「没照抄」）
 *
 * - `loading && view === undefined` 才占加载面、后续唤醒**原地刷新**（`loadedRef`）；
 * - 空态要「已加载 + 无错误 + 真为 0」三个条件同时成立；
 * - `subscribeChanges` 的 `failed` 分支把宿主原因显示在面板的错误行；
 * - 拖拽排序（`SortableRow` + `useSidebarRowDrag` + `moveSidebarItem`）整条链；
 * - `+` 按钮、`Modal` 的页脚按钮组、`form` 的各个 `label`/`Input` 结构；
 * - 创建表单的成员多选（`MultiMenuField` + `TeamPresenceDot` 图标）。
 *
 * @module @sophia/core/client/vendor/team/TeamChannelsPanel
 */

import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { AgentTeamChannelRef, AgentTeamClientMemberStatus } from './agent-team-types.ts'
import type { WorkspaceId } from './ids.ts'
import type { TeamChannelView, TeamSidebarProps } from './slots.ts'
import { MultiMenuField } from './multi-menu-field.tsx'
import { SortableRow, useSidebarRowDrag } from './sidebar-drag.tsx'
import { moveSidebarItem, useSidebarOrder } from './sidebar-order.ts'
import { useSidebarSectionOpen, setSidebarSectionOpen } from './sidebar-sections.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import createCss from './create.module.css'
import css from './sidebar.module.css'

interface TeamChannelsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly loadChannels: TeamSidebarProps['loadChannels']
  /** Membership and channel facts change outside this panel; the workspace scope keeps the list fresh. */
  readonly subscribeChanges: TeamSidebarProps['subscribeChanges']
  readonly createChannel: TeamSidebarProps['createChannel']
  readonly selectedChannelRef?: AgentTeamChannelRef
  readonly selectChannel: TeamSidebarProps['selectChannel']
  readonly t: TeamSidebarProps['t']
}

export function TeamChannelsPanel(props: TeamChannelsPanelProps) {
  const { workspaceId, loadMembers, loadChannels, subscribeChanges, createChannel, selectedChannelRef, selectChannel, t } = props
  const { useCallback, useEffect, useMemo, useRef, useState } = hooks()
  const { Button, IconPlusOutline16, Input, Modal, Tooltip } = primitives
  const [view, setView] = useState<TeamChannelView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [mutating, setMutating] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Row order is this browser's presentation preference; the drag commits
  // through the single shared mutation below.
  const channelRefs = useMemo(() => view?.channels.map(channel => channel.channelRef) ?? [], [view])
  const orderedChannelRefs = useSidebarOrder(workspaceId, 'channels', channelRefs)
  const orderedChannels = useMemo(() => {
    const byRef = new Map((view?.channels ?? []).map(channel => [channel.channelRef, channel]))
    return orderedChannelRefs.map(channelRef => byRef.get(channelRef)).filter(channel => channel !== undefined)
  }, [orderedChannelRefs, view])
  const applyMove = (movedRef: AgentTeamChannelRef, targetRef: AgentTeamChannelRef, marker: 'before' | 'after'): void => {
    void moveSidebarItem(workspaceId, 'channels', orderedChannelRefs, movedRef, targetRef, marker)
  }
  const drag = useSidebarRowDrag({ refs: orderedChannelRefs, onCommit: applyMove })
  const sectionOpen = useSidebarSectionOpen(workspaceId, 'channels')

  // Only the first refresh owns the loading surface; later wakes (workspace
  // catalog changes, channel creation) refresh the rendered rows in place.
  const loadedRef = useRef(false)
  const refresh = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    const [channelResult, memberResult] = await Promise.all([
      loadChannels({ workspaceId, limit: 1 }),
      loadMembers({ workspaceId }),
    ])
    if (channelResult.ok && memberResult.ok) {
      setView(channelResult.value)
      const visibleMembers = memberResult.value.filter(status => status.member.state !== 'inactive' && status.member.state !== 'archived')
      setMembers(visibleMembers)
      const selectable = new Set(visibleMembers.filter(status => status.presence !== 'unavailable')
        .map(status => status.member.memberId))
      setSelected(current => new Set([...current].filter(memberId => selectable.has(memberId))))
      setError(undefined)
      loadedRef.current = true
    } else if (!channelResult.ok) {
      setError(channelResult.error.message)
    } else if (!memberResult.ok) {
      setError(memberResult.error.message)
    }
    setLoading(false)
  }, [loadChannels, loadMembers, workspaceId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeChanges({ kind: 'workspace', workspaceId }, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    void refresh()
  }), [subscribeChanges, refresh, workspaceId])

  const closeForm = () => {
    if (mutating) return
    setFormOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutating || name.trim() === '') return
    // ⚠ 索菲亚移植点：上游这里算 `requestId` 并在「同一份载荷」时复用同一个 id
    // （宿主侧幂等重放保护）。索菲亚宿主 `/api/sophia/channel` **不接受**
    // `requestId`（见 `requests.ts` 的幂等键说明）⇒ 这里只传索菲亚真有的
    // `{workspaceId, title}`。**重试语义因此变了**：索菲亚的重复提交会真的建出
    // 两个频道 —— 这是宿主事实的落差，不是本面板的疏忽（如实记录）。
    setMutating(true)
    setError(undefined)
    try {
      const result = await createChannel({ workspaceId, title: name.trim() })
      if (result.ok) {
        setName('')
        setDescription('')
        setSelected(new Set())
        setFormOpen(false)
        await refresh()
        queueMicrotask(() => { triggerRef.current?.focus() })
      } else {
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(false)
    }
  }

  return (
    <div className={css.panel}>
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={t('addChannel')}
        closeLabel={t('close')}
        contentClassName={createCss.dialogContent!}
        footer={<><Button variant="outline" disabled={mutating} onClick={closeForm}>{t('cancel')}</Button><Button type="submit" form="team-channel-create-form" variant="primary" disabled={mutating || name.trim() === ''}>{mutating ? t('creatingChannel') : t('createChannel')}</Button></>}
      >
        <form id="team-channel-create-form" className={createCss.form} onSubmit={event => { void submit(event) }}>
          <label className={createCss.field}><span>{t('channelName')}</span><Input className={createCss.input!} value={name} disabled={mutating} autoFocus onChange={event => { setName(event.target.value) }} /></label>
          {/* ⚠ 索菲亚移植点：这个字段**保留但禁用**，并如实说明原因。
              索菲亚的 `POST /api/sophia/channel` 只接受 `{teamId, title}`
              （`panel-store.ts:549` 的 `requestCreateChannel`），**没有描述字段** ——
              留一个能输入却永远发不出去的框，就是在承诺一件做不到的事。
              处置手法与 `bridge.ts` 的 `TEAM_HALT_AVAILABLE` 同源：
              控件保留（删了就没人知道为什么没有），但把「不可用」明说出来。 */}
          <label className={createCss.field}><span>{t('channelDescription')}{t('optionalSuffix')}</span><Input className={createCss.input!} value={description} placeholder={t('agentDescriptionPlaceholder')} disabled onChange={event => { setDescription(event.target.value) }} /></label>
          <p className={css.editHint}>{t('sidebarChannelDescriptionUnsupported')}</p>
          {/* ⚠ 索菲亚移植点（独立评审抓到的 high，**这块的 `disabled` 是必须的**）：
              上游在这个表单里收「初始成员」，索菲亚的 `POST /api/sophia/channel`
              只接受 `{teamId, title}` —— `memberIds` **发不出去**。
              初版这里写的是 `disabled={mutating}`（只在提交中禁），于是这个多选是**活的**：
              用户能选、选完点「创建」、选择被 `setSelected(new Set())` 静默清掉，
              界面上没有任何一处说它没生效。这与本批的处置纪律（`TEAM_HALT_AVAILABLE`
              那套：不可用要明说）自相矛盾，而且是用户输入静默丢失。
              ⇒ 现在与上面那个「描述」框同一处置：控件保留（删了就没人知道为什么没有）、
              恒 `disabled`、并在下面给一行如实提示。
              ⚠ 「控件保留」是**有代价**的：`disabled` 的触发器仍显示「尚未选择成员」，
              所以那行提示是这块唯一的真相来源，不能删。 */}
          <MultiMenuField label={t('initialMembers')} disabled
            options={members.map(status => ({
              id: status.member.memberId,
              label: status.member.handle,
              ...(status.presence === 'unavailable' ? { disabled: true, hint: t('memberUnavailableReason') } : {}),
              icon: <TeamPresenceDot status={status} t={t} />,
            }))}
            selected={[...selected]}
            onToggle={id => {
              setSelected(current => {
                const next = new Set(current)
                if (next.has(id)) next.delete(id); else next.add(id)
                return next
              })
            }}
            triggerEmptyLabel={t('membersPickerEmpty')}
            formatCount={count => t('membersPickerCount', { count })} />
          <p className={css.editHint}>{t('sidebarInitialMembersUnsupported')}</p>
          {error !== undefined && <p className={createCss.error} role="alert">{error}</p>}
        </form>
      </Modal>
      <TeamSidebarSection
        title={t('channels')}
        open={sectionOpen}
        onToggle={open => { setSidebarSectionOpen(workspaceId, 'channels', open) }}
        actions={(
          <Tooltip label={t('addChannel')} delayMs={500}>
            <button ref={triggerRef} type="button" className={css.iconButton} aria-label={t('addChannel')} onClick={() => { setError(undefined); setFormOpen(true) }}>
              <IconPlusOutline16 size={14} />
            </button>
          </Tooltip>
        )}
      >
        {loading && view === undefined && <p className={css.emptyState}>{t('loadingChannels')}</p>}
        {/* An empty claim needs a loaded projection, and a standing error
            overrides it: a failed load reports through the error line instead
            of additionally reading as "no channels yet". */}
        {!loading && error === undefined && view !== undefined && view.channels.length === 0 && <p className={css.emptyState}>{t('emptyChannels')}</p>}
        <div className={css.channelList}>
          {orderedChannels.map(channel => (
            <SortableRow key={channel.channelRef} drag={drag} orderKey={channel.channelRef}>
              <ChannelRow
                channel={channel}
                selected={selectedChannelRef === channel.channelRef}
                selectChannel={selectChannel}
              />
            </SortableRow>
          ))}
        </div>
      </TeamSidebarSection>
      {!formOpen && error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </div>
  )
}

/**
 * One sidebar Channel row: the select button keeps the `#` identity.
 *
 * ⚠ 索菲亚移植点：上游这一行还有**行尾省略号菜单**（编辑 / 归档）与它带出的
 * 两个对话框。索菲亚宿主**没有**改频道名 / 归档频道的路由，而且索菲亚的频道
 * **没有归档态**（`agent-team-types.ts` 的 `AgentTeamChannel`）⇒ 菜单与
 * 两个对话框一并剥掉（`TeamRowMenu.tsx` 仍在本目录，由 `TeamAgentsPanel`
 * 使用，见该文件）。行本身的几何、`aria-current`、`# 名称` 文本逐字照抄。
 */
function ChannelRow({ channel, selected, selectChannel }: {
  readonly channel: { readonly channelRef: AgentTeamChannelRef; readonly name: string }
  readonly selected: boolean
  readonly selectChannel: TeamSidebarProps['selectChannel']
}) {
  return (
    <article className={css.channelRow} aria-current={selected ? 'page' : undefined}>
      <button type="button" className={css.channelSelect} aria-label={`# ${channel.name}`} onClick={() => { selectChannel(channel.channelRef) }}>
        <strong className={css.channelName}># {channel.name}</strong>
      </button>
    </article>
  )
}
