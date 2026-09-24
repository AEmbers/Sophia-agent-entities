// ⚠ 索菲亚移植点（**只改 import**）：上游写的是
// `import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'` —— 顶层**值导入**，
// 会多出一条顶层模块加载调用，撞红「`require(` ≤ 2」的既有断言（实测当前恰好 2）。
// 索菲亚的现成手法是 `../bridge.ts` 的 `primitives` **惰性代理**（取值推迟到
// 首次属性访问），与本目录 `StagingPlanEditor.tsx` 取 `Menu` 的方式逐字同源。
import { primitives } from '../bridge.ts'
import type { AgentTeamClientMemberStatus } from './agent-team-types.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import type { TeamStateDotState } from './agent-team-types.ts'
import css from './presence.module.css'

/**
 * 上游这里取的是 `TeamSidebarProps['t']`（一个 40+ 成员的大 props 表）。
 * 本文件只用得到「翻译函数」这一项 ⇒ 收窄成最小形状。
 * 这不是放宽检查：`TeamSidebarProps` 在本目录**不存在**（见 `slots.ts` 的剥除清单），
 * 而为一行 `t` 去重建那份 40 成员的假契约正是本目录要避免的东西。
 */
type Translate = (key: string, params?: Record<string, unknown>) => string

export function presenceLabel(status: AgentTeamClientMemberStatus, t: Translate): string {
  const label = status.presence === 'available' ? t('statusAvailable')
    : status.presence === 'working' ? t('statusWorking')
      : status.presence === 'error' ? t('statusError') : t('statusUnavailable')
  return status.diagnostic === undefined ? label : `${label}: ${diagnosticText(status)}`
}

/**
 * One line of human-readable diagnostic text.
 *
 * ⚠ **索菲亚不产出任何诊断**（成员运行期失败不落账本、也不进线格式，见
 * `agent-team-types.ts` 的 `AgentTeamClientMemberStatus` 说明）⇒
 * 本函数在索菲亚**恒返回 `''`**（`status.diagnostic` 恒 `undefined`）。
 *
 * 保留它而不是删掉：`TeamThreadPage` 的运行时风险区（上游 726–768 行）
 * 与 `TeamPresenceDot` 的标签都调它，删掉就要在那些位置各写一次「索菲亚没有诊断」。
 * 留在这里，**「没有诊断」只有一处出口**，将来宿主补上诊断时也只改这一处。
 */
export function diagnosticText(status: AgentTeamClientMemberStatus): string {
  const diagnostic = status.diagnostic
  if (diagnostic === undefined) return ''
  return diagnostic.location === undefined ? diagnostic.detail : `${diagnostic.detail} (${diagnostic.location.path})`
}

/**
 * Whether the restart action can help an unavailable Member.
 *
 * ⚠ 同 `diagnosticText`：索菲亚没有诊断 ⇒ `diagnostic` 恒 `undefined` ⇒
 * 本函数**恒 `true`**（「可以重启」）。但索菲亚**也没有**「重启成员」这条路由
 * （`host.ts` 的 9 条路由里没有），故调用点（Thread 页的风险区）**不展示重启按钮** ——
 * 否则就是一个点了没反应的控件。本函数保留为纯函数以备将来。
 */
export function restartOffered(status: AgentTeamClientMemberStatus): boolean {
  const diagnostic = status.diagnostic
  if (diagnostic === undefined) return true
  if (diagnostic.class === 'rollover') return false
  return !(diagnostic.class === 'session-refused' && diagnostic.remediable === false)
}

/** Shared presence → indicator mapping for dots and avatar badges. */
export function presenceDotState(presence: AgentTeamClientMemberStatus['presence']): TeamStateDotState {
  return presence === 'available' ? 'done' : presence === 'working' ? 'ongoing' : presence === 'error' ? 'error' : 'quiet'
}

export function TeamPresenceDot({ status, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly t: Translate
}) {
  const label = presenceLabel(status, t)
  return (
    <primitives.Tooltip label={label} delayMs={300}>
      <span className={css.target} role="img" aria-label={label}>
        <TeamStateDot state={presenceDotState(status.presence)} />
      </span>
    </primitives.Tooltip>
  )
}
