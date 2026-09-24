import type { ReactElement } from 'react'
import { CLASS } from '../../styles.ts'
import type { TeamStateDotState } from './agent-team-types.ts'

/**
 * 上游 `TeamStateDot.tsx` 的索菲亚版 —— 状态点。
 *
 * ## 上游这里是什么
 *
 * 上游从一个宿主原子 `StateDot`（`@deepseek-ai/dsh-client-ui-primitives`）
 * 借四色状态，并对它没有的两个状态（`todo` 空心环、`quiet` 灰点）**本地补一份几何**
 * （`state-dot.module.css`），理由是「每个界面都要画成同一个形状」。
 *
 * ## 索菲亚的处置：换成**索菲亚自己的点**（改动②的后半）
 *
 * 索菲亚已经有一套完全同用途的点：`styles.ts` 的
 * `CLASS.dot` + `dotRunning` / `dotIdle` / `dotSuspended` / `dotTombstone` / `dotUnknown`
 * （`components.tsx` 的 `StateDot` 正是用它渲染的，并带 OCR 修复要求的
 * `data-sophia-visual` 同源标记 —— 见 `scripts/check-t5-structure.mjs` 的针）。
 *
 * 上游那个 `StateDot` 原子**索菲亚没有**（它是宿主 `ui-primitives` 的成员，
 * 索菲亚的 `upstream-modules.d.ts` 只声明了自己用到的那几个：`Menu` 等），
 * ⇒ 用索菲亚这套点替代，**同一份 CSS 只有一处定义**，
 * 界面上「在岗 / 空闲 / 暂停 / 墓碑 / 未知」五种状态与面板其它地方**完全一致**。
 *
 * ## ⚠ 保留了哪些上游取值（没有删）
 *
 * 上游六态（`todo` / `ongoing` / `warning` / `done` / `error` / `quiet`）在本文件里
 * **全部仍然可传**，只是映射到索菲亚的五种视觉：
 *
 * | 上游取值 | 索菲亚视觉 | 理由 |
 * |---|---|---|
 * | `ongoing` / `warning` | `running` / `suspended` | 同义（在跑 / 有异常） |
 * | `done` | `idle` | 「不忙了」= 空闲，索菲亚没有独立的「完成」点 |
 * | `error` / `quiet` | `tombstone` | 「出事了 / 静下来了」→ 索菲亚的墓碑灰点 |
 * | `todo` | `unknown` | ⚠ **最有争议的一条**：空心环（未开始）在索菲亚没有对应物。
 *   映射到 `unknown`（虚线点）而不是 `idle`：`idle` 会被读成「空闲可用」，
 *   而 `todo` 的语义是「还没开始」—— 两者都不是「未知」，但 `unknown` 至少
 *   **不会谎称它可用**。如实记录为已知的语义弱化。 |
 */
export function TeamStateDot({ state, size = 10 }: {
  readonly state: TeamStateDotState
  readonly size?: number | undefined
}): ReactElement {
  const visual = dotVisualOf(state)
  return (
    <span
      className={`${CLASS.dot} ${DOT_CLASS[visual]}`}
      style={{ width: size, height: size }}
      // 与索菲亚 `components.tsx` 的 `StateDot` **同一个属性名与同一个口径**：
      // 「颜色与文案同源」这一条 OCR 修复靠这个属性被判（见结构门禁的 `ocrFixes`）。
      data-sophia-visual={visual}
      // 装饰性：状态文案由旁边/父级的 `aria-label` / `title` 给出
      //（上游 `TeamPresenceDot` 就是那样子做的）。
      aria-hidden="true"
    />
  )
}

/** 索菲亚的视觉取值（`components.tsx` 的 `DotVisual` 同集合）。 */
export type TeamDotVisual = 'tombstone' | 'running' | 'idle' | 'suspended' | 'unknown'

/** 视觉取值 → 索菲亚的类名。**逐条与 `components.tsx` 的 `DOT_CLASS` 同源。** */
const DOT_CLASS: Readonly<Record<TeamDotVisual, string>> = {
  tombstone: CLASS.dotTombstone,
  running: CLASS.dotRunning,
  idle: CLASS.dotIdle,
  suspended: CLASS.dotSuspended,
  unknown: CLASS.dotUnknown,
}

/** 上游取值 → 索菲亚视觉。映射理由见 `TeamStateDot` 的表格。 */
function dotVisualOf(state: TeamStateDotState): TeamDotVisual {
  if (state === 'ongoing') return 'running'
  if (state === 'warning') return 'suspended'
  if (state === 'done') return 'idle'
  if (state === 'error' || state === 'quiet') return 'tombstone'
  // 'todo' —— 见 `TeamStateDot` 表格里的 ⚠。
  return 'unknown'
}
