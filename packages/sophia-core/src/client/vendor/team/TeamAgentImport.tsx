/**
 * 上游 `TeamAgentImport.tsx`（77 行）的索菲亚版 —— **把别处的成员导入本团**。
 *
 * ## ⚠ 索菲亚当前**没有调用点**，且它的数据面在索菲亚**恒空**（如实说明）
 *
 * 上游这个组件是「导入 Agent」弹窗的主体：列出**尚未加入本 Workspace**
 * 的成员，点一行就把该成员 join 进来。判断「谁还没加入」的那一行是：
 *
 * ```ts
 * result.value.filter(status => (state === 'enabled' || 'suspended') && !status.workspaceIds.includes(workspaceId))
 * ```
 *
 * 两个上游事实在索菲亚**都不存在**：
 *
 * - `status.workspaceIds` —— 索菲亚没有 Workspace 维，成员只有一个归属团；
 * - `joinWorkspace` 这个写面 —— 索菲亚宿主没有「成员加入本团」的路由
 *   （建团时成员已定；`/api/sophia/member` 是**加一个职位**，语义不同）。
 *
 * ⇒ 组件结构、状态机（`loading` / `error` / `pending` / 空态 / 重试）、
 * 类名（`create.module.css` 的 `form` / `notice` / `state` / `roster` /
 * `failure` / `error`）与两处 `aria` 语义**逐字照抄**；
 * 而「候选成员」由**调用方给的 `loadMembers`** 决定 ——
 * 索菲亚的 `rosterOf` 只给本团成员 ⇒ 候选列表**恒空** ⇒ 界面走上游的
 * `emptyImportAgents` 空态文案。这正是索菲亚的真实状态：
 * **没有可导入的成员**，而不是「组件坏了」。
 *
 * 抄它的理由与 `team-membership.ts` / `human-identity.ts` 同源：主人在依赖清单里
 * 点名了它；宿主补上「加入本团」这条路后，接回只需在 `index.ts` 里给一个
 * `joinWorkspace` —— 本文件一行不用改。
 *
 * ## 索菲亚移植点（三处）
 *
 * | 上游 | 索菲亚 | 理由 |
 * |---|---|---|
 * | `import { useCallback, useEffect, useRef, useState } from 'react'` | `hooks()` 惰性取 | 顶层值导入会多撞一次 `require(` ≤ 2 的断言 |
 * | `mintRequestId()`（`./requests.ts`） | **剥掉** | 索菲亚宿主没有任何幂等键面（见 `requests.ts` 文件头） |
 * | `workspaceId: WorkspaceId` + `TeamSidebarProps` | 剥掉 / 换成 `TeamConversationProps` 的对应成员 | 索菲亚没有 Workspace 维；`slots.ts` 的 `TeamSidebarProps` 是左栏总表（这里的字段与它同源，取其成员类型更忠实于本组件的输入） |
 *
 * @module @sophia/core/client/vendor/team/TeamAgentImport
 */

import type { ReactElement } from 'react'
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { AgentTeamClientMemberStatus } from './agent-team-types.ts'
import type { TeamConversationProps } from './slots.ts'
import { TeamMemberRow } from './TeamMemberRow.tsx'
import css from './create.module.css'

/** 一次「加入本团」请求。⚠ 上游是 `AgentTeamJoinWorkspaceRequest`（带 requestId + workspaceId）。 */
export interface TeamJoinRequest {
  readonly memberId: string
}

export function TeamAgentImport({ loadMembers, joinWorkspace, onJoined, onPending, t }: {
  readonly loadMembers: TeamConversationProps['loadMembers']
  /**
   * 「让这个成员加入本团」。
   *
   * ⚠ 索菲亚宿主没有这条路由 ⇒ 调用方可以不提供（`undefined`）——
   * 那种情况下**点行会得到一条明确的拒绝信息**，而不是静默无反应
   * （见 `join` 里的分支与 `bridge.ts` 的 `HALT_URL` 同一处置手法）。
   */
  readonly joinWorkspace?: ((request: TeamJoinRequest) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }>) | undefined
  readonly onJoined: () => Promise<void>
  readonly onPending: (pending: boolean) => void
  readonly t: TeamConversationProps['t']
}): ReactElement {
  const { useCallback, useEffect, useRef, useState } = hooks()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<string>()
  const busy = useRef(false)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setError(undefined)
    try {
      const result = await loadMembers()
      if (current !== generation.current) return
      if (!result.ok) throw new Error(result.error.message)
      // ⚠ 上游那一行是
      //   `filter(status => (state === 'enabled' | 'suspended') && !status.workspaceIds.includes(workspaceId))`。
      //   两半索菲亚都对不上：
      //   - 取值名：索菲亚的 `AgentTeamMemberState` 只有 `'active' | 'inactive' | 'archived'`
      //     （见 `agent-team-types.ts`），没有上游的 `enabled` / `suspended`；
      //   - `workspaceIds`：索菲亚**没有** Workspace 维，也没有第二个归属面。
      //   ⇒ 保留上游那一半的**语义**（「存活态的成员」= 不是墓碑），用索菲亚的取值写：
      //     `archived` 是墓碑（`adapters.memberStateOf` 把 archived/destroyed 都映到它），
      //     其余两种都是在册的成员。这与 `adapters.rosterOf` 的既有过滤口径同源。
      //   ⚠ 后果如实说：候选列表里会出现**本团已在册**的成员 ——
      //     「谁还没加入本团」这个事实索菲亚结构上不可知（没有第二个归属面）。
      setMembers(result.value.filter(status => status.member.state !== 'archived'))
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [loadMembers])
  useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  const join = async (status: AgentTeamClientMemberStatus) => {
    if (busy.current) return
    busy.current = true
    setPending(status.member.memberId)
    onPending(true)
    setError(undefined)
    try {
      // ⚠ 索菲亚降级路径：没有 joinWorkspace 就**明说**（不假装成功、不静默无反应）。
      if (joinWorkspace === undefined) {
        setError('索菲亚宿主还没有「成员加入本团」的路由：成员在建团时就已确定。这个动作没有生效。')
        return
      }
      const result = await joinWorkspace({ memberId: status.member.memberId })
      if (!result.ok) throw new Error(result.error.message)
      await onJoined()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      busy.current = false
      setPending(undefined)
      onPending(false)
    }
  }
  return <div className={css.form}>
    <p className={css.notice}>{t('importAgentNotice')}</p>
    {loading && <p className={css.state} role="status">{t('loadingAgents')}</p>}
    {!loading && error === undefined && members.length === 0 && <p className={css.state}>{t('emptyImportAgents')}</p>}
    {!loading && members.length > 0 && <div className={css.roster}>
      {members.map(status => <TeamMemberRow key={status.member.memberId} status={status} action={{
        label: pending === status.member.memberId ? t('importingAgent') : t('importAgent'),
        disabled: pending !== undefined,
        onSelect: () => { void join(status) },
      }} />)}
    </div>}
    {error !== undefined && <div className={css.failure} role="alert"><p className={css.error}>{error}</p><primitives.Button disabled={pending !== undefined} variant="outline" onClick={() => { void load() }}>{t('retry')}</primitives.Button></div>}
  </div>
}
