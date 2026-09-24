/**
 * 文档 3.6 · 审批区：待处理的建团申请卡（两级审批的**第二级**人类出口）。
 *
 * 数据源是 `WireView.pendingPlans`（投影 spawn 票而来）。**过滤在调用方**：
 * `panel.tsx` 只传入 `status === 'awaiting'` 的票 —— 本组件按传入渲染
 * （OCR：注释不能替组件承诺它自己不执行的保证）。已有结论的票不占版面。
 * 决定通过 `onDecide` 上抛给挂载层（`seats.tsx` 负责 POST + 强刷视图），
 * 组件自己只管 busy 状态：一次一张卡，处理中禁按钮（防双击重复提交 ——
 * 宿主侧幂等是兜底，UI 先不制造重放）。
 *
 * @module @sophia/core/client/StagingDualPlanEditor
 */
import type { ReactElement } from 'react'
import { hooks } from './react-runtime.ts'
import { CLASS } from './styles.ts'
import type { Translate } from './components.tsx'
import type { WirePendingPlan } from '../wire.ts'

export interface StagingDualPlanEditorProps {
  readonly plans: readonly WirePendingPlan[]
  readonly t: Translate
  readonly onDecide: (requestId: string, decision: 'approve' | 'reject') => Promise<void>
  /**
   * 建团模式的**唯一状态源**（与活动面板的拟建团块**同一份**）。
   *
   * ⚠ 2026-09-24（团长授权）：原先这里两个单选是写死的 `defaultChecked disabled`，
   * 理由是「v1 的提交契约不携带 mode，可点却不生效的单选比禁用更坏」。
   * 现在改成**受控**：读 `value(requestId)`、写 `onChange(requestId, mode)`，
   * 状态归 `panel.tsx` 所有（`planModeControl`）⇒ 两处 UI **不可能各存一份、显示还不一样**。
   * `dag` 仍然**诚实禁用**（阶段 3 链路未实现）；`persistent` 可点。
   * 缺省不传 = 退回旧行为（只读 + 选中持久团），既有调用点不用改。
   */
  readonly planMode?: {
    readonly value: (requestId: string) => 'persistent' | 'dag'
    readonly onChange: (requestId: string, mode: 'persistent' | 'dag') => void
  } | undefined
}

export function StagingDualPlanEditor(props: StagingDualPlanEditorProps): ReactElement {
  const { plans, t, onDecide, planMode } = props
  const { useState } = hooks()
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)

  const decide = (requestId: string, decision: 'approve' | 'reject'): void => {
    if (busyRequestId !== null) return
    setBusyRequestId(requestId)
    // OCR [15]：`onDecide` 的契约不禁止 reject —— 少了 catch 会留下一个
    // 无人处理的 rejection（busy 状态虽由 finally 复位，进程日志会炸红）。
    void onDecide(requestId, decision)
      .catch((error: unknown) => {
        console.warn('[sophia] onDecide rejected:', error)
      })
      .finally(() => {
        setBusyRequestId(null)
      })
  }

  return (
    <div className={CLASS.approval} data-sophia-approval="present">
      <div className={CLASS.approvalTitle}>{t('approvalTitle')}</div>
      {plans.map((plan) => {
        const busy = busyRequestId === plan.requestId
        return (
          <div
            key={plan.requestId}
            className={CLASS.approvalCard}
            data-sophia-approval-card={plan.requestId}
          >
            <div className={CLASS.approvalCardHead}>
              <span className={CLASS.approvalBadge}>
                {plan.targetKind === 'persistent'
                  ? t('approvalKindPersistent')
                  : t('approvalKindTemporary')}
              </span>
              <span>{plan.name}</span>
            </div>
            <div className={CLASS.approvalMeta}>
              {t('approvalRosterLabel')}：
              {plan.roster.map((entry) => `${entry.position} × ${entry.count}`).join('、') || '—'}
            </div>
            <div className={CLASS.approvalMeta}>
              {t('approvalTasksLabel')}：{plan.tasks.join('、') || '—'}
            </div>
            {/* 模式单选（文档 2.4 StagingDualPlan）：**受控**于 `panel.tsx` 的那一份状态
                （与活动面板的拟建团块同源，团长 2026-09-24 授权改）。
                `persistent` 可点；`dag-scheduler` **诚实禁用** —— 阶段 3 才开放建团链路，
                做成「能点、点了没后果」比禁用更坏（它会谎报选择有后果）。
                缺省不传 `planMode` 时不接 onChange（退回只读，与旧行为一致）。 */}
            <div className={CLASS.modeRow}>
              <span className={CLASS.modeLabel}>{t('modeLabel')}：</span>
              <label>
                <input
                  type="radio"
                  name={`sophia-mode-${plan.requestId}`}
                  data-sophia-mode="persistent-team"
                  checked={planMode === undefined ? true : planMode.value(plan.requestId) === 'persistent'}
                  disabled={planMode === undefined}
                  onChange={planMode === undefined
                    ? undefined
                    : () => { planMode.onChange(plan.requestId, 'persistent') }}
                />
                {' '}{t('modePersistent')}
              </label>
              <label>
                <input
                  type="radio"
                  name={`sophia-mode-${plan.requestId}`}
                  data-sophia-mode="dag-scheduler"
                  disabled
                />
                {' '}{t('modeDag')}
              </label>
            </div>
            <div className={CLASS.approvalActions}>
              <button
                type="button"
                className={`${CLASS.approvalButton} ${CLASS.approvalButtonApprove}`}
                data-sophia-action="approve-plan"
                // ⚠ OCR [24]：`decide()` 的 guard 是**全局** early-return
                //   （busy 期间其它卡的点击是静默空操作）—— 按钮只禁本卡
                //   就会造出「看得见、点了没反应」的按钮，与文件头的
                //   「处理中禁按钮」也不一致。一卡在途，全部按钮一起禁。
                disabled={busyRequestId !== null}
                onClick={() => {
                  decide(plan.requestId, 'approve')
                }}
              >
                {busy ? t('decisionWorking') : t('approve')}
              </button>
              <button
                type="button"
                className={CLASS.approvalButton}
                data-sophia-action="reject-plan"
                disabled={busyRequestId !== null}
                onClick={() => {
                  decide(plan.requestId, 'reject')
                }}
              >
                {busy ? t('decisionWorking') : t('reject')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
