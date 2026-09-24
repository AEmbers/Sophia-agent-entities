/**
 * 文档 5 · DAG 依赖视图（阶段 3 画布的 v1 形态）。
 *
 * 数据源是 `WireView.dagTeams`（投影 `dag/team-created` / `dag/ownership-transferred` /
 * `dag/task-state-changed` 三事件而来）。**诚实边界**：一期的 `spec.tasks` 是
 * `string[]`（没有依赖边），所以本画布渲染的是**任务节点 + 当前态**，节点间的
 * 依赖关系如实标注为「阶段 3 提供」—— 不画假边（假边比没有边更误导）。
 *
 * 只读组件：不接回调（移交走运营路由 / 工具面）。
 *
 * @module @sophia/core/client/DagCanvas
 */
import type { ReactElement } from 'react'
import { CLASS } from './styles.ts'
import type { Translate } from './components.tsx'
import type { WireDagTeam } from '../wire.ts'

export interface DagCanvasProps {
  readonly dagTeams: readonly WireDagTeam[]
  readonly t: Translate
}

export function DagCanvas(props: DagCanvasProps): ReactElement {
  const { dagTeams, t } = props
  return (
    <div className={CLASS.dagWrap} data-sophia-dag-list={dagTeams.length}>
      <div className={CLASS.dagTitle}>{t('dagTitle')}</div>
      {dagTeams.map((dag) => (
        <section
          key={dag.dagTeamId}
          className={CLASS.dagCanvas}
          data-sophia-dag-canvas={dag.dagTeamId}
        >
          <div className={CLASS.dagHead}>
            <span>{dag.dagTeamId}</span>
            <span className={CLASS.dagMeta}>{t('dagOwnerLabel')}：{dag.ownerMemberId}</span>
          </div>
          <div className={CLASS.dagNodes}>
            {dag.tasks.length === 0
              ? <span className={CLASS.dagMeta}>{t('dagTaskEmpty')}</span>
              : dag.tasks.map((task) => (
                  <span
                    key={task.taskId}
                    className={CLASS.dagNode}
                    data-sophia-dag-state={task.state}
                  >
                    {task.taskId} · {task.state}
                  </span>
                ))}
          </div>
        </section>
      ))}
      {/* OCR LOW：静态脚注渲染**一次**（曾在每张卡里重复同一句）。 */}
      <div className={CLASS.dagMeta}>{t('dagDependenciesNote')}</div>
    </div>
  )
}
